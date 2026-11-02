namespace Herdr;

// What a tile shows besides herdr's own statuses. `None`: nothing occupies the
// slot. `Offline`: herdr cannot be reached.
public static class TileStatus
{
    public const string None = "none";
    public const string Offline = "offline";
}

public abstract class Tile
{
    public const int SlotCount = 9;

    // Presses are applied one at a time so rapid taps each see the focus state
    // left by the previous one instead of racing on a stale snapshot.
    private static readonly SemaphoreSlim PressGate = new(1, 1);

    protected Tile(HerdrClient client, string kind, int slot, string description, string groupName)
    {
        Client = client;
        Slot = slot;
        Name = $"herdr_{kind.ToLowerInvariant()}_{slot}";
        DisplayName = $"{kind} {slot}";
        Placeholder = $"{kind} {slot}";
        Label = Placeholder;
        Description = description;
        GroupName = groupName;
    }

    protected HerdrClient Client { get; }
    public int Slot { get; }
    public string Name { get; }
    public string DisplayName { get; protected init; }
    public string Description { get; }
    public string GroupName { get; }
    public string Status { get; set; } = TileStatus.None;
    public string Label { get; set; }
    // Shown while nothing occupies the slot. Options+ reserves the label row
    // either way, so a blank label leaves the ring looking too high on the key.
    public string Placeholder { get; }

    public abstract void Update(Snapshot snapshot);

    // Null when nothing occupies the slot, so the press does nothing.
    public abstract Task? Press();

    // Most tiles show a status ring (TileFaces.ImageFor); NewTabTile overrides
    // this to show the same tab+plus face regardless of status.
    public virtual byte[] Image => TileFaces.ImageFor(Status);

    protected static async Task Enqueue(Func<Task> task)
    {
        await PressGate.WaitAsync();
        try
        {
            await task();
        }
        finally
        {
            PressGate.Release();
        }
    }

    public static string Ordinal(int n)
    {
        string[] suffixes = ["th", "st", "nd", "rd"];
        var v = n % 100;
        var tens = (v - 20) % 10;
        return n + (tens is > 0 and < 4 ? suffixes[tens] : v < 4 ? suffixes[v] : suffixes[0]);
    }
}

public sealed class SpaceTile(HerdrClient client, int slot) : Tile(
    client,
    "Space",
    slot,
    $"Status of herdr workspace {slot}; press to focus it, press again to cycle its panes",
    "Spaces")
{
    private string? workspaceId;

    public override void Update(Snapshot snapshot)
    {
        var workspace = snapshot.Workspaces.GetValueOrDefault(Slot);
        workspaceId = workspace?.WorkspaceId;
        Status = workspace?.AgentStatus ?? TileStatus.None;
        Label = string.IsNullOrEmpty(workspace?.Label) ? Placeholder : workspace.Label;
    }

    public override Task? Press()
    {
        if (workspaceId is not { } id) return null;
        return Enqueue(async () =>
        {
            var nextPaneId = HerdrClient.NextPaneInFocusedWorkspace(await Client.GetSnapshotAsync(), id);
            if (nextPaneId is not null) await Client.FocusPaneAsync(nextPaneId);
            else await Client.FocusWorkspaceAsync(id);
        });
    }
}

public class AgentTile : Tile
{
    private string? paneId;

    public AgentTile(HerdrClient client, int slot)
        : this(client, slot, "Agent", $"Status of the {Ordinal(slot)} running herdr agent; press to focus it", "Agents")
    {
    }

    protected AgentTile(HerdrClient client, int slot, string kind, string description, string groupName)
        : base(client, kind, slot, description, groupName)
    {
    }

    public override void Update(Snapshot snapshot) => Apply(snapshot.Agents);

    protected void Apply(IReadOnlyList<Agent> agents)
    {
        var agent = Slot <= agents.Count ? agents[Slot - 1] : null;
        paneId = agent?.PaneId;
        Status = agent?.AgentStatus ?? TileStatus.None;
        Label = string.IsNullOrEmpty(agent?.TerminalTitleStripped) ? Placeholder : agent.TerminalTitleStripped;
    }

    public override Task? Press()
    {
        if (paneId is not { } id) return null;
        return Enqueue(() => Client.FocusPaneAsync(id));
    }
}

// The most recently active agents, so a handful of keys can cover a session
// running more agents than there are tiles.
public sealed class RecentAgentTile : AgentTile
{
    public RecentAgentTile(HerdrClient client, int slot)
        : base(client, slot, "Recent", $"Status of the {Ordinal(slot)} most recently active herdr agent; press to focus it", "Recent Agents")
    {
        DisplayName = $"Recent Agent {slot}";
    }

    public override void Update(Snapshot snapshot) => Apply(snapshot.Recent);
}

// Opens a new, focused shell tab in the matching herdr workspace. The face
// always shows the tab+plus icon (TileFaces.TabImage), never a status ring,
// and the label is the workspace name alone — no "+ tab" prefix, since the
// icon already says "new tab" and a shorter label truncates less often.
public sealed class NewTabTile : Tile
{
    public NewTabTile(HerdrClient client, int slot)
        : base(client, "New", slot, $"Create a new shell tab in herdr workspace {slot}", "Tabs")
    {
        DisplayName = $"New Tab {slot}";
    }

    public override byte[] Image => TileFaces.TabImage;

    public override void Update(Snapshot snapshot)
    {
        var workspace = snapshot.Workspaces.GetValueOrDefault(Slot);
        Status = workspace is not null ? "idle" : TileStatus.None;
        Label = string.IsNullOrEmpty(workspace?.Label) ? Placeholder : workspace.Label;
    }

    // Always enqueued: whether the workspace exists is checked against a
    // fresh snapshot when the press runs, not against state cached at the
    // last poll.
    public override Task? Press() => Enqueue(() => RunAsync(Slot));

    private async Task RunAsync(int targetSpace)
    {
        try
        {
            await Client.ActivateTerminalAsync().WaitAsync(TimeSpan.FromSeconds(3));
        }
        catch (Exception e)
        {
            Log.Warning($"NewTabTile: terminal activation failed (continuing): {e.Message}");
        }

        Snapshot snapshot;
        try
        {
            snapshot = await Client.GetSnapshotAsync();
        }
        catch (Exception e)
        {
            Log.Error($"NewTabTile: session.snapshot failed: {e.Message}");
            return;
        }

        var workspace = snapshot.Workspaces.GetValueOrDefault(targetSpace);
        if (workspace is null)
        {
            Log.Error($"NewTabTile: no workspace with number {targetSpace}");
            return;
        }

        try
        {
            await Client.CreateTabAsync(workspace.WorkspaceId);
        }
        catch (Exception e)
        {
            Log.Error($"NewTabTile: tab.create failed: {e.Message}");
        }
    }
}

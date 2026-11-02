namespace Herdr;

// What a tile shows besides herdr's own statuses. `None`: nothing occupies the
// slot. `Offline`: herdr cannot be reached.
public static class TileStatus
{
    public const string None = "none";
    public const string Offline = "offline";
}

// The key face's data: the ring is driven by Tile.Status; this carries the
// main number (workspace number), the tab-position superscript, the project
// name (drawn in the band) and the session (service text).
public readonly record struct Face
{
    public int? Tab { get; init; }
    public int? TabNumber { get; init; }
    public string Project { get; init; } = "";
    public string Session { get; init; } = "";

    public Face()
    {
    }

    public static Face Empty(int? tab = null) => new() { Tab = tab };
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
    public Face Face { get; set; } = new();
    // Shown while nothing occupies the slot. Options+ reserves the label row
    // either way, so a blank label leaves the ring looking too high on the key.
    public string Placeholder { get; }

    public abstract void Update(Snapshot snapshot);

    // Null when nothing occupies the slot, so the press does nothing.
    public abstract Task? Press();

    // Most tiles show a composite key face (TileFaces.FaceFor: ring, number,
    // superscript and project band); NewTabTile overrides this to show the
    // same tab+plus face regardless of status.
    public virtual byte[] Image => TileFaces.FaceFor(this);

    // The service text under the key: the session line only (the project name
    // is drawn in the image band). NewTabTile overrides this to keep showing
    // its workspace-name label.
    public virtual string ServiceText => TileFaces.ServiceText(Face.Session);

    /// <summary>Changes whenever the drawn key face (ring, number or band) would change.</summary>
    public string FaceKey => string.Join(
        "\u0001", Status, Face.Tab?.ToString() ?? "", Face.TabNumber?.ToString() ?? "", Face.Project, Face.Session);

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

    /// <summary>
    /// The agent a Space key shows as its session: the workspace's agent that
    /// is most recent in `recent` (matched by pane id), else the first in
    /// `agents`.
    /// </summary>
    public static Agent? SessionAgentFor(string workspaceId, IReadOnlyList<Agent> agents, IReadOnlyList<Agent> recent)
    {
        var candidates = agents.Where(a => a.WorkspaceId == workspaceId).ToList();
        Agent? best = null;
        var bestRank = int.MaxValue;
        foreach (var candidate in candidates)
        {
            var rank = recent.ToList().FindIndex(r => r.PaneId == candidate.PaneId);
            if (rank != -1 && rank < bestRank)
            {
                best = candidate;
                bestRank = rank;
            }
        }
        return best ?? candidates.FirstOrDefault();
    }

    /// <summary>`{ TabNumber }` when the tab's position is known, else null (the face omits the superscript).</summary>
    protected static int? TabNumberOf(IReadOnlyDictionary<string, int> tabs, string? tabId) =>
        tabId is not null && tabs.TryGetValue(tabId, out var position) ? position : null;
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
        Face = workspace is null
            ? Face.Empty(Slot)
            : new Face
            {
                Tab = workspace.Number,
                TabNumber = TabNumberOf(snapshot.Tabs, workspace.ActiveTabId),
                Project = workspace.Label,
                Session = SessionAgentFor(workspace.WorkspaceId, snapshot.Agents, snapshot.Recent)?.TerminalTitleStripped ?? "",
            };
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

    public override void Update(Snapshot snapshot) => Apply(snapshot, snapshot.Agents);

    protected void Apply(Snapshot snapshot, IReadOnlyList<Agent> agents)
    {
        var agent = Slot <= agents.Count ? agents[Slot - 1] : null;
        paneId = agent?.PaneId;
        Status = agent?.AgentStatus ?? TileStatus.None;
        Label = string.IsNullOrEmpty(agent?.TerminalTitleStripped) ? Placeholder : agent.TerminalTitleStripped;
        if (agent is null)
        {
            Face = Face.Empty(Slot);
            return;
        }
        var workspace = snapshot.Workspaces.Values.FirstOrDefault(w => w.WorkspaceId == agent.WorkspaceId);
        Face = new Face
        {
            Tab = workspace?.Number,
            TabNumber = TabNumberOf(snapshot.Tabs, agent.TabId),
            Project = workspace?.Label ?? "",
            Session = agent.TerminalTitleStripped,
        };
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

    public override void Update(Snapshot snapshot) => Apply(snapshot, snapshot.Recent);
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

    public override string ServiceText => TileFaces.LabelText(Label);

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

using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Herdr;

public sealed class HerdrException(string message) : Exception(message);

public sealed class HerdrClient
{
    public static readonly string DefaultSocketPath =
        Environment.GetEnvironmentVariable("HERDR_SOCKET_PATH")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config/herdr/herdr.sock");

    // The herdr socket protocol this plugin was written and tested against (herdr 0.8.2).
    public const int TestedProtocol = 20;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);
    // tab.create spawns a shell and waits for it to report ready, which takes
    // longer than the other requests.
    private static readonly TimeSpan TabCreateTimeout = TimeSpan.FromSeconds(10);

    internal static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly RecencyTracker recency = new();
    private readonly Terminal terminal;
    private int nextId;
    private bool warnedProtocol;

    public HerdrClient(string? socketPath = null, Terminal? terminal = null)
    {
        SocketPath = socketPath ?? DefaultSocketPath;
        this.terminal = terminal ?? new Terminal();
    }

    public string SocketPath { get; }

    // One request per connection: herdr answers with a single JSON line.
    public async Task<JsonElement> RequestAsync(string method, object? parameters = null, TimeSpan? timeout = null)
    {
        var id = $"logi_{Interlocked.Increment(ref nextId)}";
        using var cts = new CancellationTokenSource(timeout ?? RequestTimeout);
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        string? line;
        try
        {
            await socket.ConnectAsync(new UnixDomainSocketEndPoint(SocketPath), cts.Token);
            await using var stream = new NetworkStream(socket, ownsSocket: false);
            var request = JsonSerializer.Serialize(new { id, method, @params = parameters ?? new { } }) + "\n";
            await stream.WriteAsync(Encoding.UTF8.GetBytes(request), cts.Token);
            // The reader decodes as a stream, so a multi-byte character split
            // across reads survives.
            using var reader = new StreamReader(stream, Encoding.UTF8);
            line = await reader.ReadLineAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            throw new HerdrException($"herdr {method}: timed out");
        }
        if (line is null) throw new HerdrException($"herdr {method}: connection closed before a response arrived");

        JsonElement message;
        try
        {
            using var document = JsonDocument.Parse(line);
            message = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new HerdrException($"herdr {method}: malformed response");
        }
        if (message.ValueKind != JsonValueKind.Object) throw new HerdrException($"herdr {method}: malformed response");
        if (message.TryGetProperty("error", out var error) && error.ValueKind != JsonValueKind.Null)
        {
            throw new HerdrException($"herdr {method}: {error.GetRawText()}");
        }
        return message.TryGetProperty("result", out var result) ? result : default;
    }

    public async Task<Snapshot> GetSnapshotAsync()
    {
        var result = await RequestAsync("session.snapshot");
        var snapshot = result.ValueKind == JsonValueKind.Object && result.TryGetProperty("snapshot", out var s)
            ? s.Deserialize<RawSnapshot>(Json)
            : null;
        if (snapshot is null) throw new HerdrException("herdr session.snapshot: response has no snapshot");
        if (snapshot.Protocol != TestedProtocol && !warnedProtocol)
        {
            warnedProtocol = true;
            Log.Warning(
                $"herdr {snapshot.Version} speaks socket protocol {snapshot.Protocol}; this plugin was tested against protocol {TestedProtocol}");
        }
        var workspaces = new Dictionary<int, Workspace>();
        foreach (var w in snapshot.Workspaces) workspaces[w.Number] = w;
        var numberOf = new Dictionary<string, int>();
        foreach (var w in workspaces.Values) numberOf[w.WorkspaceId] = w.Number;
        var agents = snapshot.Agents
            .OrderBy(a => numberOf.GetValueOrDefault(a.WorkspaceId))
            .ThenBy(a => a.PaneId, Comparer<string>.Create(ComparePaneIds))
            .ToList();
        var layouts = new Dictionary<string, Layout>();
        foreach (var l in snapshot.Layouts) layouts[l.TabId] = l;
        var tabs = new Dictionary<string, int>();
        var perWorkspace = new Dictionary<string, int>();
        foreach (var t in snapshot.Tabs ?? [])
        {
            var position = perWorkspace.GetValueOrDefault(t.WorkspaceId) + 1;
            perWorkspace[t.WorkspaceId] = position;
            tabs[t.TabId] = position;
        }
        return new Snapshot
        {
            FocusedWorkspaceId = snapshot.FocusedWorkspaceId,
            Workspaces = workspaces,
            Agents = agents,
            Recent = recency.Rank(agents),
            Layouts = layouts,
            Tabs = tabs,
        };
    }

    // Pane ids look like `w1:p10`; compare their numeric parts so p10 sorts after p2.
    public static int ComparePaneIds(string a, string b)
    {
        int i = 0, j = 0;
        while (i < a.Length && j < b.Length)
        {
            if (char.IsAsciiDigit(a[i]) && char.IsAsciiDigit(b[j]))
            {
                var startA = i;
                var startB = j;
                while (i < a.Length && char.IsAsciiDigit(a[i])) i++;
                while (j < b.Length && char.IsAsciiDigit(b[j])) j++;
                var numberA = a[startA..i].TrimStart('0');
                var numberB = b[startB..j].TrimStart('0');
                var byNumber = numberA.Length != numberB.Length
                    ? numberA.Length.CompareTo(numberB.Length)
                    : string.CompareOrdinal(numberA, numberB);
                if (byNumber != 0) return byNumber;
            }
            else
            {
                if (a[i] != b[j]) return a[i].CompareTo(b[j]);
                i++;
                j++;
            }
        }
        return (a.Length - i).CompareTo(b.Length - j);
    }

    public async Task FocusWorkspaceAsync(string workspaceId)
    {
        _ = terminal.ActivateAsync();
        await RequestAsync("workspace.focus", new { workspace_id = workspaceId });
    }

    // Exposed so a tile can raise the terminal itself before it does other
    // async work (NewTabTile), instead of relying on a focus call to do it.
    public Task ActivateTerminalAsync() => terminal.ActivateAsync();

    public Task CreateTabAsync(string workspaceId) =>
        RequestAsync("tab.create", new { workspace_id = workspaceId, focus = true }, TabCreateTimeout);

    public async Task FocusPaneAsync(string paneId)
    {
        _ = terminal.ActivateAsync();
        await RequestAsync("pane.focus", new { pane_id = paneId });
    }

    public static string? NextPaneInFocusedWorkspace(Snapshot snapshot, string workspaceId)
    {
        if (snapshot.FocusedWorkspaceId != workspaceId) return null;
        var workspace = snapshot.Workspaces.Values.FirstOrDefault(w => w.WorkspaceId == workspaceId);
        if (workspace is null || !snapshot.Layouts.TryGetValue(workspace.ActiveTabId, out var layout)) return null;
        if (layout.Panes.Count < 2) return null;
        var index = layout.Panes.ToList().FindIndex(p => p.PaneId == layout.FocusedPaneId);
        return layout.Panes[(index + 1) % layout.Panes.Count].PaneId;
    }
}

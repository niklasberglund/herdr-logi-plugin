using System.Text.Json.Serialization;

namespace Herdr;

// Statuses are kept as strings: one herdr gained after this plugin was written
// must reach the tiles, which show it as unknown, rather than fail to parse.
public static class AgentStatus
{
    public const string Idle = "idle";
    public const string Working = "working";
    public const string Blocked = "blocked";
    public const string Done = "done";
    public const string Unknown = "unknown";
}

public sealed record Workspace
{
    public string WorkspaceId { get; init; } = "";
    public string ActiveTabId { get; init; } = "";
    public int Number { get; init; }
    public string Label { get; init; } = "";
    public string AgentStatus { get; init; } = Herdr.AgentStatus.Unknown;
}

public sealed record Agent
{
    public string PaneId { get; init; } = "";
    public string WorkspaceId { get; init; } = "";
    [JsonPropertyName("agent")]
    public string Kind { get; init; } = "";
    public string AgentStatus { get; init; } = Herdr.AgentStatus.Unknown;
    public string TerminalTitleStripped { get; init; } = "";
    public string? TabId { get; init; }
}

// A tab's membership, used only to compute its 1-based position within its
// workspace's tabs.
public sealed record TabRef
{
    public string TabId { get; init; } = "";
    public string WorkspaceId { get; init; } = "";
}

public sealed record Pane
{
    public string PaneId { get; init; } = "";
}

public sealed record Layout
{
    public string TabId { get; init; } = "";
    public string FocusedPaneId { get; init; } = "";
    public IReadOnlyList<Pane> Panes { get; init; } = [];
}

public sealed record Snapshot
{
    public string? FocusedWorkspaceId { get; init; }
    public IReadOnlyDictionary<int, Workspace> Workspaces { get; init; } = new Dictionary<int, Workspace>();
    public IReadOnlyList<Agent> Agents { get; init; } = [];
    public IReadOnlyList<Agent> Recent { get; init; } = [];
    public IReadOnlyDictionary<string, Layout> Layouts { get; init; } = new Dictionary<string, Layout>();
    // tab_id -> 1-based position of the tab among its workspace's tabs (snapshot order).
    public IReadOnlyDictionary<string, int> Tabs { get; init; } = new Dictionary<string, int>();

    public static readonly Snapshot Empty = new();
}

// session.snapshot as herdr sends it.
internal sealed record RawSnapshot
{
    public string Version { get; init; } = "";
    public int Protocol { get; init; }
    public string? FocusedWorkspaceId { get; init; }
    public List<Workspace> Workspaces { get; init; } = [];
    public List<Agent> Agents { get; init; } = [];
    public List<Layout> Layouts { get; init; } = [];
    public List<TabRef>? Tabs { get; init; }
}

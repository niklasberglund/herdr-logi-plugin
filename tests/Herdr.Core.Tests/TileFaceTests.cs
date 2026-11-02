namespace Herdr.Tests;

public class TileFaceTests
{
    private static readonly HerdrClient Client = new("/nonexistent/herdr.sock");

    private static readonly Agent[] Agents =
    [
        new() { PaneId = "w1:p1", WorkspaceId = "w1", TabId = "w1:t2", Kind = "claude", AgentStatus = "working", TerminalTitleStripped = "Fix login" },
        new() { PaneId = "w2:p1", WorkspaceId = "w2", TabId = "w2:t1", Kind = "codex", AgentStatus = "blocked", TerminalTitleStripped = "" },
    ];

    private static readonly Snapshot Snapshot = new()
    {
        FocusedWorkspaceId = "w1",
        Workspaces = new Dictionary<int, Workspace>
        {
            [1] = new() { WorkspaceId = "w1", ActiveTabId = "w1:t1", Number = 1, Label = "herdr", AgentStatus = "working" },
            [2] = new() { WorkspaceId = "w2", ActiveTabId = "w2:t1", Number = 2, Label = "api", AgentStatus = "blocked" },
        },
        Agents = Agents,
        Recent = [Agents[1], Agents[0]],
        Tabs = new Dictionary<string, int> { ["w1:t1"] = 1, ["w1:t2"] = 2, ["w2:t1"] = 1 },
    };

    [Fact]
    public void ASpaceTileFaceCarriesItsWorkspaceNumberProjectAndSessionAgent()
    {
        var space = new SpaceTile(Client, 1);
        space.Update(Snapshot);
        Assert.Equal(1, space.Face.Tab);
        Assert.Equal(1, space.Face.TabNumber); // workspace's active tab is w1:t1 -> position 1
        Assert.Equal("herdr", space.Face.Project);
        Assert.Equal("Fix login", space.Face.Session);
    }

    [Fact]
    public void ASpaceTileWithNoWorkspaceShowsItsSlotNumberButNoProjectOrSession()
    {
        var space = new SpaceTile(Client, 5);
        space.Update(Snapshot);
        Assert.Equal(5, space.Face.Tab);
        Assert.Null(space.Face.TabNumber);
        Assert.Equal("", space.Face.Project);
        Assert.Equal("", space.Face.Session);
    }

    [Fact]
    public void AnAgentTileFaceUsesItsOwningWorkspaceNumberAndTabPosition()
    {
        var agent = new AgentTile(Client, 1);
        agent.Update(Snapshot);
        Assert.Equal(1, agent.Face.Tab); // agents[0] belongs to w1
        Assert.Equal(2, agent.Face.TabNumber); // w1:t2
        Assert.Equal("herdr", agent.Face.Project);
        Assert.Equal("Fix login", agent.Face.Session);
    }

    [Fact]
    public void AnAgentTileWithNoAgentUsesItsSlotNumberButNoTabPositionOrProject()
    {
        var agent = new AgentTile(Client, 9);
        agent.Update(Snapshot);
        Assert.Equal(9, agent.Face.Tab); // Face.Empty falls back to the slot, like an empty SpaceTile
        Assert.Null(agent.Face.TabNumber);
        Assert.Equal("", agent.Face.Project);
        Assert.Equal("", agent.Face.Session);
    }

    [Fact]
    public void ServiceTextShowsOnlyTheSessionNeverTheProjectName()
    {
        var space = new SpaceTile(Client, 1);
        space.Update(Snapshot);
        Assert.Equal("Fix login", space.ServiceText);
        Assert.DoesNotContain("herdr", space.ServiceText);
    }

    [Fact]
    public void ServiceTextIsBlankWhenThereIsNoSession()
    {
        var space = new SpaceTile(Client, 2); // "api" workspace, no matching agent title
        space.Update(Snapshot);
        Assert.Equal(TileFaces.Blank, space.ServiceText);
    }

    [Fact]
    public void ANewTabTileServiceTextStaysTheWorkspaceLabel()
    {
        var newTab = new NewTabTile(Client, 2);
        newTab.Update(Snapshot);
        Assert.Equal("api", newTab.ServiceText);
    }

    [Fact]
    public void FaceKeyChangesWhenTheSessionProjectOrTabNumberChangesButNotFromStatusAlone()
    {
        var space = new SpaceTile(Client, 1);
        space.Update(Snapshot);
        var key1 = space.FaceKey;

        var changedSession = Snapshot with
        {
            Agents = [Agents[0] with { TerminalTitleStripped = "Different title" }, Agents[1]],
        };
        space.Update(changedSession);
        Assert.NotEqual(key1, space.FaceKey);
    }

    [Fact]
    public void ClearingToAnEmptySnapshotResetsTheFace()
    {
        var space = new SpaceTile(Client, 2);
        space.Update(Snapshot);
        Assert.Equal("api", space.Face.Project);
        space.Update(Snapshot.Empty);
        Assert.Equal("", space.Face.Project);
        Assert.Equal("", space.Face.Session);
    }
}

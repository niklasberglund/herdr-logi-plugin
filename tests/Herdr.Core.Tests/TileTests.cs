namespace Herdr.Tests;

public class TileTests
{
    private static readonly HerdrClient Client = new("/nonexistent/herdr.sock");

    private static readonly Agent[] Agents =
    [
        new() { PaneId = "w1:p1", WorkspaceId = "w1", Kind = "claude", AgentStatus = "working", TerminalTitleStripped = "Fix login" },
        new() { PaneId = "w2:p1", WorkspaceId = "w2", Kind = "codex", AgentStatus = "blocked", TerminalTitleStripped = "" },
    ];

    private static readonly Snapshot Snapshot = new()
    {
        FocusedWorkspaceId = "w1",
        Workspaces = new Dictionary<int, Workspace>
        {
            [2] = new() { WorkspaceId = "w2", ActiveTabId = "w2:t1", Number = 2, Label = "api", AgentStatus = "blocked" },
        },
        Agents = Agents,
        Recent = [Agents[1], Agents[0]],
    };

    [Fact]
    public void Ordinals()
    {
        Assert.Equal(
            ["1st", "2nd", "3rd", "4th", "9th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"],
            new[] { 1, 2, 3, 4, 9, 11, 12, 13, 21, 22, 23, 101 }.Select(Tile.Ordinal));
    }

    [Fact]
    public void NamesGroupsAndDescriptions()
    {
        var space = new SpaceTile(Client, 3);
        Assert.Equal("herdr_space_3", space.Name);
        Assert.Equal("Space 3", space.DisplayName);
        Assert.Equal("Spaces", space.GroupName);
        var agent = new AgentTile(Client, 2);
        Assert.Equal("herdr_agent_2", agent.Name);
        Assert.Contains("2nd running", agent.Description);
        var recent = new RecentAgentTile(Client, 1);
        Assert.Equal("herdr_recent_1", recent.Name);
        Assert.Equal("Recent Agent 1", recent.DisplayName);
        Assert.Contains("1st most recently", recent.Description);
        var newTab = new NewTabTile(Client, 4);
        Assert.Equal("herdr_new_4", newTab.Name);
        Assert.Equal("New Tab 4", newTab.DisplayName);
        Assert.Equal("Tabs", newTab.GroupName);
        Assert.Contains("workspace 4", newTab.Description);
    }

    [Fact]
    public void TilesFollowTheSnapshotAndClearOnAnEmptyOne()
    {
        var space1 = new SpaceTile(Client, 1);
        var space2 = new SpaceTile(Client, 2);
        var agent1 = new AgentTile(Client, 1);
        var recent1 = new RecentAgentTile(Client, 1);
        var agent3 = new AgentTile(Client, 3);
        foreach (Tile tile in new Tile[] { space1, space2, agent1, recent1, agent3 }) tile.Update(Snapshot);
        Assert.Equal(("none", "Space 1"), (space1.Status, space1.Label));
        Assert.Equal(("blocked", "api"), (space2.Status, space2.Label));
        Assert.Equal(("working", "Fix login"), (agent1.Status, agent1.Label));
        Assert.Equal(("blocked", "Recent 1"), (recent1.Status, recent1.Label));
        Assert.Equal(("none", "Agent 3"), (agent3.Status, agent3.Label));

        Tile[] cleared = [space2, agent1, recent1];
        foreach (var tile in cleared) tile.Update(Snapshot.Empty);
        Assert.Equal([("none", "Space 2"), ("none", "Agent 1"), ("none", "Recent 1")], cleared.Select(t => (t.Status, t.Label)));
    }

    [Fact]
    public void ANewTabTileShowsTheWorkspaceNameAloneAndNoPrefix()
    {
        var newTab1 = new NewTabTile(Client, 1);
        var newTab2 = new NewTabTile(Client, 2);
        newTab1.Update(Snapshot);
        newTab2.Update(Snapshot);
        Assert.Equal(("none", "New 1"), (newTab1.Status, newTab1.Label));
        Assert.Equal(("idle", "api"), (newTab2.Status, newTab2.Label));
        Assert.DoesNotContain("+ tab", newTab2.Label);
    }

    [Fact]
    public void ANewTabTileAlwaysShowsTheTabIconRegardlessOfStatus()
    {
        var newTab = new NewTabTile(Client, 1);
        var beforeUpdate = newTab.Image;
        newTab.Update(Snapshot);
        Assert.Same(TileFaces.TabImage, beforeUpdate);
        Assert.Same(TileFaces.TabImage, newTab.Image);
    }

    [Fact]
    public void ATileWithNothingBehindItIgnoresPresses()
    {
        var space = new SpaceTile(Client, 1);
        space.Update(Snapshot.Empty);
        Assert.Null(space.Press());
        var agent = new AgentTile(Client, 5);
        agent.Update(Snapshot);
        Assert.Null(agent.Press());
    }

    [Fact]
    public void LabelsAreBlankedKeptOrTruncatedByCharacter()
    {
        Assert.Equal("​", TileFaces.LabelText(""));
        Assert.Equal("short", TileFaces.LabelText("short"));
        Assert.Equal("exactly 10", TileFaces.LabelText("exactly 10"));
        Assert.Equal("a longer …", TileFaces.LabelText("a longer title"));
        Assert.Equal("🐑🐑🐑🐑🐑🐑🐑🐑🐑…", TileFaces.LabelText("🐑🐑🐑🐑🐑🐑🐑🐑🐑🐑🐑"));
    }
}

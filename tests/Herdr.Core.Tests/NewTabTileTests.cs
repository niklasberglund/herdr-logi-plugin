using System.Text.Json;

namespace Herdr.Tests;

public class NewTabTileTests
{
    // Stands in for `ps` and `open` so a press never launches or raises a real
    // terminal app.
    private sealed class NoOpTerminal : Terminal
    {
        protected override Task<string> RunAsync(string command, params string[] args) => Task.FromResult("");
    }

    [Fact]
    public async Task PressCreatesAFocusedTabInTheMatchingWorkspace()
    {
        using var herdr = new FakeHerdr();
        string? capturedMethod = null;
        JsonElement capturedParams = default;
        herdr.Behaviour = (socket, line) =>
        {
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            var method = root.GetProperty("method").GetString();
            if (method == "session.snapshot")
            {
                return FakeHerdr.SendAndClose(socket, """
                    {"id":"x","result":{"snapshot":{"version":"0.8.2","protocol":20,"focused_workspace_id":null,
                    "workspaces":[{"workspace_id":"w2","active_tab_id":"w2:t1","number":2,"label":"api","agent_status":"idle"}],
                    "agents":[],"layouts":[]}}}
                    """.ReplaceLineEndings("") + "\n");
            }
            capturedMethod = method;
            capturedParams = root.GetProperty("params").Clone();
            return FakeHerdr.SendAndClose(socket, """{"id":"x","result":{}}""" + "\n");
        };

        // The tile can hit herdr for session.snapshot and tab.create on the
        // same socket, one connection per request, so run two fake servers
        // keyed by the request content instead of assuming a single roundtrip.
        var tile = new NewTabTile(new HerdrClient(herdr.SocketPath, new NoOpTerminal()), 2);
        await tile.Press()!;

        Assert.Equal("tab.create", capturedMethod);
        Assert.Equal("w2", capturedParams.GetProperty("workspace_id").GetString());
        Assert.True(capturedParams.GetProperty("focus").GetBoolean());
    }

    [Fact]
    public async Task PressLogsAndDoesNothingWhenTheWorkspaceIsGone()
    {
        using var herdr = new FakeHerdr();
        herdr.Behaviour = (socket, _) => FakeHerdr.SendAndClose(socket, """
            {"id":"x","result":{"snapshot":{"version":"0.8.2","protocol":20,"focused_workspace_id":null,
            "workspaces":[],"agents":[],"layouts":[]}}}
            """.ReplaceLineEndings("") + "\n");

        using var log = new LogCapture();
        var tile = new NewTabTile(new HerdrClient(herdr.SocketPath, new NoOpTerminal()), 5);
        await tile.Press()!;

        Assert.Contains(log.Errors, e => e.Contains("no workspace with number 5"));
    }
}

namespace Loupedeck.HerdrPlugin;

using Herdr;

public class HerdrPlugin : Plugin
{
    private readonly CancellationTokenSource stop = new();
    private readonly Dictionary<string, TileCommand> commands = [];

    public override bool UsesApplicationApiOnly => true;

    public override bool HasNoApplication => true;

    public HerdrPlugin()
    {
        Herdr.Log.Info = text => this.Log.Info(text);
        Herdr.Log.Warning = text => this.Log.Warning(text);
        Herdr.Log.Error = text => this.Log.Error(text);
    }

    public override void Load()
    {
        var client = new HerdrClient();
        var slots = Enumerable.Range(1, Tile.SlotCount).ToList();
        List<Tile> tiles =
        [
            .. slots.Select(n => new SpaceTile(client, n)),
            .. slots.Select(n => new AgentTile(client, n)),
            .. slots.Select(n => new RecentAgentTile(client, n)),
            .. slots.Select(n => new NewTabTile(client, n)),
        ];
        foreach (var tile in tiles)
        {
            var command = new TileCommand(tile);
            commands[tile.Name] = command;
            this.AddDynamicAction(command);
        }
        Herdr.Log.Info($"{tiles.Count} tiles registered, polling {client.SocketPath}");
        var board = new TileBoard(client, tiles, tile => commands[tile.Name].Redraw());
        _ = Task.Run(() => board.RunAsync(this.stop.Token));
    }

    public override void Unload() => this.stop.Cancel();
}

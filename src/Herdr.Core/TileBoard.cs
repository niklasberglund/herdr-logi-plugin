namespace Herdr;

// Polls herdr and keeps every tile's status and label current, calling
// `changed` for each tile whose face needs redrawing.
public sealed class TileBoard(HerdrClient client, IReadOnlyList<Tile> tiles, Action<Tile> changed)
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);

    // A tile whose snapshot cannot be applied is left showing what it showed
    // before. Each failure is reported once per tile, because the poll runs every
    // second and would otherwise fill the log with the same line.
    private readonly HashSet<string> warnedTiles = [];

    public IReadOnlyList<Tile> Tiles => tiles;

    // Never throws. A single bad tile must not stop the remaining slots from
    // updating, nor take down the poll loop that schedules the next run.
    public void Apply(Snapshot? snapshot)
    {
        foreach (var tile in tiles)
        {
            try
            {
                var (faceKey, text) = (tile.FaceKey, tile.ServiceText);
                tile.Update(snapshot ?? Snapshot.Empty);
                if (snapshot is null)
                {
                    tile.Status = TileStatus.Offline;
                    tile.Label = "offline";
                    tile.Face = new Face();
                }
                if (faceKey != tile.FaceKey || text != tile.ServiceText) changed(tile);
            }
            catch (Exception e)
            {
                if (warnedTiles.Add(tile.Name))
                {
                    Log.Error($"tile '{tile.Name}' could not be updated and keeps its last state: {e.Message}");
                }
            }
        }
    }

    // Each poll starts only after the previous one finished, so a slow herdr
    // never produces overlapping polls that could apply snapshots out of order.
    //
    // `Update()` is also what gives each tile the workspace or pane its press
    // focuses, so without this loop the keys would go stale as well as static.
    public async Task RunAsync(CancellationToken cancel)
    {
        var online = true;
        var first = true;
        while (!cancel.IsCancellationRequested)
        {
            Snapshot? snapshot = null;
            try
            {
                snapshot = await client.GetSnapshotAsync();
                if (!online) Log.Info("herdr is reachable again");
                online = true;
            }
            catch (Exception e)
            {
                if (online) Log.Warning($"herdr is unreachable, tiles show offline: {e.Message}");
                online = false;
            }
            Apply(snapshot);
            // The service keeps faces from an earlier run (or an earlier install)
            // and only asks again when told, so a tile whose state matches its
            // initial one would never be refreshed.
            if (first)
            {
                first = false;
                foreach (var tile in tiles) changed(tile);
            }
            try
            {
                await Task.Delay(PollInterval, cancel);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}

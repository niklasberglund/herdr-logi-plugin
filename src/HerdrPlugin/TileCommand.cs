namespace Loupedeck.HerdrPlugin;

using Herdr;

// One key action per tile, added by HerdrPlugin. Each keeps the tile's name
// (`herdr_space_1` and so on): profiles refer to keys by it, and it names the
// icon in actionicons/ and actionsymbols/. The service also tries to create one
// itself and logs a harmless warning because there is no parameterless
// constructor.
public sealed class TileCommand : PluginDynamicCommand
{
    private readonly Tile tile;

    public TileCommand(Tile tile)
        : base(tile.DisplayName, tile.Description, tile.GroupName, DeviceType.All)
    {
        this.tile = tile;
        this.Name = tile.Name;
    }

    public void Redraw()
    {
        try
        {
            this.ActionImageChanged();
        }
        catch (Exception e)
        {
            this.Log.Error(e, $"could not redraw '{this.Name}'");
        }
    }

    protected override void RunCommand(string actionParameter)
    {
        this.tile.Press()?.ContinueWith(
            press => this.Log.Warning($"'{this.Name}' press failed: {press.Exception?.GetBaseException().Message}"),
            TaskContinuationOptions.OnlyOnFaulted);
    }

    protected override BitmapImage GetCommandImage(string actionParameter, PluginImageSize imageSize) =>
        BitmapImage.FromArray(this.tile.Image);

    protected override string GetCommandDisplayName(string actionParameter, PluginImageSize imageSize) =>
        this.tile.ServiceText;
}

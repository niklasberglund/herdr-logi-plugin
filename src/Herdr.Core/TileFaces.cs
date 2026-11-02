using System.Collections.Concurrent;
using System.Text;

namespace Herdr;

public static class TileFaces
{
    public const int ImageSize = 80;
    private const int MaxLabelChars = 10;

    private static readonly Dictionary<string, (Rgb Rgb, RingStyle Style)> Styles = new()
    {
        [AgentStatus.Blocked] = (new Rgb(230, 40, 40), RingStyle.Filled),
        [AgentStatus.Working] = (new Rgb(240, 180, 0), RingStyle.Filled),
        [AgentStatus.Done] = (new Rgb(0, 200, 80), RingStyle.Filled),
        [AgentStatus.Idle] = (new Rgb(0, 120, 48), RingStyle.Outline),
        [AgentStatus.Unknown] = (new Rgb(150, 150, 150), RingStyle.Outline),
        [TileStatus.None] = (new Rgb(70, 70, 70), RingStyle.Dotted),
        [TileStatus.Offline] = (new Rgb(140, 50, 50), RingStyle.Dotted),
    };

    public static IReadOnlyCollection<string> KnownStatuses => Styles.Keys;

    // A status herdr gained after this plugin was written falls back to the
    // `unknown` tile. Each new name is reported once.
    private static readonly ConcurrentDictionary<string, bool> WarnedStatuses = new();

    public static (Rgb Rgb, RingStyle Style) StyleFor(string status)
    {
        if (Styles.TryGetValue(status, out var style)) return style;
        if (WarnedStatuses.TryAdd(status, true))
        {
            Log.Warning($"herdr reported agent status '{status}', which this plugin does not know; showing it as unknown");
        }
        return Styles[AgentStatus.Unknown];
    }

    private static readonly ConcurrentDictionary<string, byte[]> ImageCache = new();

    public static byte[] ImageFor(string status) => ImageCache.GetOrAdd(status, s =>
    {
        var (rgb, style) = StyleFor(s);
        return RingPng.Circle(ImageSize, rgb, style);
    });

    // The Tabs tile face: identical regardless of status (see NewTabTile), so
    // it reads as "create a tab" rather than another status ring.
    private static readonly Lazy<byte[]> TabImageLazy = new(() => TabIconPng.Draw(ImageSize));

    public static byte[] TabImage => TabImageLazy.Value;

    // The Plugin Service falls back to the action's display name when the text is
    // empty or whitespace, so an unused slot answers with a zero-width space.
    public const string Blank = "​";

    // Truncates by character (code point), not UTF-16 unit, so emoji survive.
    public static string LabelText(string text)
    {
        if (string.IsNullOrEmpty(text)) return Blank;
        var runes = text.EnumerateRunes().ToList();
        if (runes.Count <= MaxLabelChars) return text;
        var builder = new StringBuilder();
        foreach (var rune in runes.Take(MaxLabelChars - 1)) builder.Append(rune.ToString());
        return builder.Append('…').ToString();
    }
}

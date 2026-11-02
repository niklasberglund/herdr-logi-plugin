using System.Collections.Concurrent;
using System.Text;

namespace Herdr;

public static class TileFaces
{
    public const int ImageSize = 80;
    private const int MaxLabelChars = 10;
    // The project name is drawn in the image's band; the service text carries
    // only the session line. Candidate maximum, to be confirmed on device.
    private const int SessionTextMaxChars = 12;

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
    public static string LabelText(string text, int maxChars = MaxLabelChars)
    {
        if (string.IsNullOrEmpty(text)) return Blank;
        var runes = text.EnumerateRunes().ToList();
        if (runes.Count <= maxChars) return text;
        var builder = new StringBuilder();
        foreach (var rune in runes.Take(maxChars - 1)) builder.Append(rune.ToString());
        return builder.Append('…').ToString();
    }

    // Control characters (including CR/LF) become a space so a title cannot add lines.
    public static string CleanLine(string text)
    {
        var builder = new StringBuilder(text.Length);
        var lastWasControl = false;
        foreach (var ch in text)
        {
            var isControl = ch is >= '\u0000' and <= '\u001f' or >= '\u007f' and <= '\u009f' or '\u2028' or '\u2029';
            if (isControl)
            {
                if (!lastWasControl) builder.Append(' ');
            }
            else
            {
                builder.Append(ch);
            }
            lastWasControl = isControl;
        }
        return builder.ToString().Trim();
    }

    /// <summary>Service text for a key face: the session line only (the project is in the image band).</summary>
    public static string ServiceText(string session)
    {
        var cleaned = CleanLine(session);
        return cleaned.Length == 0 ? Blank : LabelText(cleaned, SessionTextMaxChars);
    }

    private static readonly ConcurrentDictionary<string, byte[]> FaceCache = new();
    private const int FaceCacheMax = 256;

    /// <summary>The key face (tab, project band and state ring) for a tile.</summary>
    public static byte[] FaceFor(Tile tile)
    {
        var key = tile.FaceKey;
        if (FaceCache.TryGetValue(key, out var cached)) return cached;
        var (rgb, style) = StyleFor(tile.Status);
        var face = tile.Face;
        var spec = new FaceSpec
        {
            Tab = face.Tab,
            TabNumber = face.Tab is null ? null : face.TabNumber,
            Project = face.Project,
            Session = face.Session,
            RingRgb = rgb,
            RingStyle = style,
            Band = ProjectColor.For(face.Project),
        };
        var rendered = FacePng.Draw(spec);
        // Bounded so rapidly changing titles cannot grow memory without limit.
        if (FaceCache.Count >= FaceCacheMax) FaceCache.Clear();
        FaceCache[key] = rendered;
        return rendered;
    }
}

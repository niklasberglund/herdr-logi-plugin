namespace Herdr;

using Pt = (double X, double Y);

public readonly record struct FaceSpec
{
    public int? Tab { get; init; }
    // 1-based position of the tab within its space; drawn as a small superscript.
    public int? TabNumber { get; init; }
    public string Project { get; init; }
    public string Session { get; init; }
    public Rgb RingRgb { get; init; }
    public RingStyle RingStyle { get; init; }
    public Rgb Band { get; init; }
}

// Composite 80x80 key face: state ring, main tab number (with an optional tab-
// position superscript) and a coloured project-name band at the bottom,
// rendered with a dependency-free bitmap font (number) and a dependency-free
// anti-aliased vector/stroke font (band text). A faithful port of the
// TypeScript `facePng()`/`png.ts` renderer, down to its numeric constants.
public static class FacePng
{
    private const int FaceSize = 80;
    private static readonly Rgb FaceBg = new(0, 0, 0);
    private static readonly Rgb White = new(255, 255, 255);
    private const int RingCx = 40;
    private const int RingCy = 29;
    private const int RingRadius = 25;
    private const int RingStroke = 6;
    private static readonly int RingOuter = (int)Math.Ceiling(RingRadius + RingStroke / 2.0);

    // Tab number: centred in the ring hole; scale 7 for one digit, 4 for two,
    // 3 for three. Filled rings knock the digits out in the background
    // colour; outline/dotted use white.
    private static readonly int[] TabScales = [7, 7, 4, 3];
    private const int TabMaxChars = 3;

    // Superscript (tab position in its space): scale 2 = 10 px caps, up to 2
    // digits (99), dropped SUP_DROP px with the main number, raised SUP_RAISE
    // px above its top, SUP_GAP px to its right.
    private const int SupScale = 2;
    private const int SupGap = 2;
    private const int SupRaise = 3;
    private const int SupDrop = 2;
    private const double SupFitRadius = 21.5;

    // Band: full width, flush to the bottom edge (y=58..79), holding the
    // project name.
    private const int BandY = 58;
    private const int BandHeight = 22;
    private const int BandPad = 3;

    private const string Ellipsis = "\u2026";

    private static int[] Glyph(string rows) => rows.Split(',').Select(r => Convert.ToInt32(r, 2)).ToArray();

    // Five rows of three bits (leftmost bit = left column). The image only
    // ever draws the tab number; anything else is not drawable.
    private static readonly Dictionary<string, int[]> BitmapFont = new()
    {
        ["0"] = Glyph("111,101,101,101,111"),
        ["1"] = Glyph("010,110,010,010,111"),
        ["2"] = Glyph("111,001,111,100,111"),
        ["3"] = Glyph("111,001,111,001,111"),
        ["4"] = Glyph("101,101,111,001,001"),
        ["5"] = Glyph("111,100,111,001,111"),
        ["6"] = Glyph("111,100,111,101,111"),
        ["7"] = Glyph("111,001,010,010,010"),
        ["8"] = Glyph("111,101,111,101,111"),
        ["9"] = Glyph("111,101,111,001,111"),
        [" "] = Glyph("000,000,000,000,000"),
        [Ellipsis] = Glyph("000,000,000,000,101"),
    };

    private static int[] BitmapGlyphFor(string ch) => BitmapFont.GetValueOrDefault(ch) ?? BitmapFont[" "];

    /// <summary>Truncates by code point, ending in an ellipsis when text is cut.</summary>
    public static string FitText(string text, int maxChars)
    {
        var runes = text.EnumerateRunes().ToList();
        if (runes.Count <= maxChars) return text;
        return string.Concat(runes.Take(Math.Max(0, maxChars - 1)).Select(r => r.ToString())) + Ellipsis;
    }

    /// <summary>Tab position text: 1..99 as is, anything larger shows 99; non-positive or NaN draws nothing.</summary>
    public static string? SuperscriptText(int? tabNumber) =>
        tabNumber is null or < 1 ? null : Math.Min(99, tabNumber.Value).ToString();

    private readonly record struct SupLayout(int MainScale, int MainX, int MainY, int SupX, int SupY);

    private static int TextWidth(int chars, int scale) => (chars * 4 - 1) * scale;

    /// <summary>
    /// Main number plus a raised superscript at its upper right, the pair
    /// centred as a block and kept inside the ring hole. The main number
    /// shrinks one step at a time until every corner of both boxes lies
    /// within SupFitRadius of the ring centre.
    /// </summary>
    private static SupLayout LayoutWithSuperscript(int mainChars, int supChars)
    {
        var supW = TextWidth(supChars, SupScale);
        var supH = 5 * SupScale;
        SupLayout layout = default;
        for (var mainScale = (mainChars < TabScales.Length ? TabScales[mainChars] : 3); mainScale >= 2; mainScale--)
        {
            var mainW = TextWidth(mainChars, mainScale);
            var mainH = 5 * mainScale;
            var blockW = mainW + SupGap + supW;
            var mainX = (int)Math.Round(RingCx - blockW / 2.0);
            var mainY = (int)Math.Round(RingCy + SupDrop - mainH / 2.0);
            var supX = mainX + mainW + SupGap;
            var supY = mainY - SupRaise;
            layout = new SupLayout(mainScale, mainX, mainY, supX, supY);
            Pt[] corners =
            [
                (mainX, mainY), (mainX + mainW, mainY), (mainX, mainY + mainH), (mainX + mainW, mainY + mainH),
                (supX, supY), (supX + supW, supY), (supX, supY + supH), (supX + supW, supY + supH),
            ];
            if (corners.All(p => Math.Sqrt(Math.Pow(p.X - RingCx, 2) + Math.Pow(p.Y - RingCy, 2)) <= SupFitRadius)) break;
        }
        return layout;
    }

    // ---- Canvas primitives -------------------------------------------------

    private static byte[] NewCanvas()
    {
        var canvas = new byte[FaceSize * FaceSize * 4];
        FillRect(canvas, 0, 0, FaceSize, FaceSize, FaceBg);
        return canvas;
    }

    private static void SetPixel(byte[] canvas, int x, int y, Rgb rgb)
    {
        if (x < 0 || y < 0 || x >= FaceSize || y >= FaceSize) return;
        var o = (y * FaceSize + x) * 4;
        canvas[o] = rgb.R;
        canvas[o + 1] = rgb.G;
        canvas[o + 2] = rgb.B;
        canvas[o + 3] = 255;
    }

    private static void FillRect(byte[] canvas, int x, int y, int w, int h, Rgb rgb)
    {
        for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) SetPixel(canvas, x + i, y + j, rgb);
    }

    private static void DrawText(byte[] canvas, string text, int x, int y, int scale, Rgb rgb)
    {
        var cx = x;
        foreach (var rune in text.EnumerateRunes())
        {
            var rows = BitmapGlyphFor(rune.ToString());
            for (var row = 0; row < 5; row++)
            {
                for (var col = 0; col < 3; col++)
                {
                    if ((rows[row] & (4 >> col)) != 0) FillRect(canvas, cx + col * scale, y + row * scale, scale, scale, rgb);
                }
            }
            cx += 4 * scale;
        }
    }

    // ---- Anti-aliased vector font ------------------------------------------
    // Glyphs are stroked polylines in font units (cap top y=0, x-height top
    // y=2.5, baseline y=8, descenders to y=10). They are rasterised by
    // supersampling: each pixel is split into SS x SS samples and the covered
    // share becomes the alpha used to blend the text colour into the pixel
    // underneath.

    private const int TextSupersample = 8;
    private const double FontSpacing = 1.5;
    private const double SpaceAdvance = 3;
    private const double TextMaxScale = 2.0; // cap height 16 px
    private const double TextMinScale = 1.5; // cap height 12 px
    private const double TextScaleStep = 0.01;
    // Horizontal squeeze of glyphs and advances (slightly condensed) to fit more characters.
    private const double TextXScale = 0.85;

    private readonly record struct VGlyph(double Adv, List<List<Pt>> Strokes);

    /// <summary>Points of an ellipse arc; angles in degrees, 0 = right, 90 = down.</summary>
    private static List<Pt> Arc(double cx, double cy, double rx, double ry, double a0, double a1)
    {
        var n = Math.Max(6, (int)Math.Ceiling(Math.Abs(a1 - a0) / 12));
        var pts = new List<Pt>();
        for (var i = 0; i <= n; i++)
        {
            var a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
            pts.Add((cx + rx * Math.Cos(a), cy + ry * Math.Sin(a)));
        }
        return pts;
    }

    /// <summary>Quadratic Bezier from p0 to p2 with control point p1.</summary>
    private static List<Pt> Bez(Pt p0, Pt p1, Pt p2)
    {
        var pts = new List<Pt>();
        for (var i = 0; i <= 10; i++)
        {
            var t = i / 10.0;
            var u = 1 - t;
            pts.Add((u * u * p0.X + 2 * u * t * p1.X + t * t * p2.X, u * u * p0.Y + 2 * u * t * p1.Y + t * t * p2.Y));
        }
        return pts;
    }

    private static List<Pt> Oval(double cx, double cy, double rx, double ry) => Arc(cx, cy, rx, ry, 0, 360);

    /// <summary>An S spanning height h from `top`, width 2*rx.</summary>
    private static List<Pt> SCurve(double rx, double top, double h)
    {
        var q = h / 4;
        var pts = Arc(rx, top + q, rx, q, 330, 90);
        pts.AddRange(Arc(rx, top + 3 * q, rx, q, 270, 510));
        return pts;
    }

    private static VGlyph Vg(List<List<Pt>> strokes, double? adv = null)
    {
        var maxX = 0.0;
        foreach (var st in strokes) foreach (var (x, _) in st) maxX = Math.Max(maxX, x);
        return new VGlyph(adv ?? maxX + FontSpacing, strokes);
    }

    private static List<Pt> Concat(params IEnumerable<Pt>[] parts) => parts.SelectMany(p => p).ToList();

    private static readonly Dictionary<string, VGlyph> VFont = new()
    {
        ["A"] = Vg([[(0, 8), (2.6, 0), (5.2, 8)], [(1, 5.4), (4.2, 5.4)]]),
        ["B"] = Vg([Concat([(0, 8), (0, 0), (3, 0)], Arc(3, 2, 2, 2, -90, 90), [(0, 4)]), Concat([(0, 4), (3.2, 4)], Arc(3.2, 6, 2, 2, -90, 90), [(0, 8)])]),
        ["C"] = Vg([Arc(2.8, 4, 2.8, 4, 40, 320)]),
        ["D"] = Vg([Concat([(0, 0), (0, 8), (2, 8)], Arc(2, 4, 3.2, 4, 90, -90), [(0, 0)])]),
        ["E"] = Vg([[(5, 0), (0, 0), (0, 8), (5, 8)], [(0, 4), (4, 4)]]),
        ["F"] = Vg([[(5, 0), (0, 0), (0, 8)], [(0, 4), (4, 4)]]),
        ["G"] = Vg([Concat(Arc(2.8, 4, 2.8, 4, 320, 40), [(5.6, 4), (3, 4)])]),
        ["H"] = Vg([[(0, 0), (0, 8)], [(5, 0), (5, 8)], [(0, 4), (5, 4)]]),
        ["I"] = Vg([[(0.8, 0), (0.8, 8)]]),
        ["J"] = Vg([Concat([(3.5, 0), (3.5, 5.5)], Arc(1.75, 5.5, 1.75, 2.5, 0, 180))]),
        ["K"] = Vg([[(0, 0), (0, 8)], [(5, 0), (0, 5)], [(1.8, 3.4), (5, 8)]]),
        ["L"] = Vg([[(0, 0), (0, 8), (4.5, 8)]]),
        ["M"] = Vg([[(0, 8), (0, 0), (3.2, 6), (6.4, 0), (6.4, 8)]]),
        ["N"] = Vg([[(0, 8), (0, 0), (5, 8), (5, 0)]]),
        ["O"] = Vg([Oval(2.8, 4, 2.8, 4)]),
        ["P"] = Vg([Concat([(0, 8), (0, 0), (2.8, 0)], Arc(2.8, 2.2, 2.2, 2.2, -90, 90), [(0, 4.4)])]),
        ["Q"] = Vg([Oval(2.8, 4, 2.8, 4), [(3.2, 5.8), (5.6, 8.4)]]),
        ["R"] = Vg([Concat([(0, 8), (0, 0), (2.8, 0)], Arc(2.8, 2.2, 2.2, 2.2, -90, 90), [(0, 4.4)]), [(2.6, 4.4), (5.2, 8)]]),
        ["S"] = Vg([SCurve(2.6, 0, 8)]),
        ["T"] = Vg([[(0, 0), (5, 0)], [(2.5, 0), (2.5, 8)]]),
        ["U"] = Vg([Concat([(0, 0), (0, 5)], Arc(2.6, 5, 2.6, 3, 180, 0), [(5.2, 0)])]),
        ["V"] = Vg([[(0, 0), (2.7, 8), (5.4, 0)]]),
        ["W"] = Vg([[(0, 0), (1.7, 8), (3.7, 2), (5.7, 8), (7.4, 0)]]),
        ["X"] = Vg([[(0, 0), (5, 8)], [(5, 0), (0, 8)]]),
        ["Y"] = Vg([[(0, 0), (2.6, 4.2), (5.2, 0)], [(2.6, 4.2), (2.6, 8)]]),
        ["Z"] = Vg([[(0, 0), (5, 0), (0, 8), (5, 8)]]),
        ["a"] = Vg([Oval(2.2, 5.25, 2.2, 2.75), [(4.4, 2.5), (4.4, 8)]]),
        ["b"] = Vg([[(0, 0), (0, 8)], Oval(2.2, 5.25, 2.2, 2.75)]),
        ["c"] = Vg([Arc(2.2, 5.25, 2.2, 2.75, 40, 320)]),
        ["d"] = Vg([Oval(2.2, 5.25, 2.2, 2.75), [(4.4, 0), (4.4, 8)]]),
        ["e"] = Vg([Concat([(0, 5.25), (4.4, 5.25)], Arc(2.2, 5.25, 2.2, 2.75, 0, -320))]),
        ["f"] = Vg([Concat([(1.2, 8), (1.2, 1.8)], Arc(2.6, 1.8, 1.4, 1.8, 180, 270), [(3.4, 0)]), [(0, 2.5), (3.2, 2.5)]]),
        ["g"] = Vg([Oval(2.2, 5.25, 2.2, 2.75), Concat([(4.4, 2.5), (4.4, 8.4)], Arc(2.2, 8.4, 2.2, 1.6, 0, 150))]),
        ["h"] = Vg([[(0, 0), (0, 8)], Concat(Arc(2.1, 4.6, 2.1, 2.1, 180, 360), [(4.2, 8)])]),
        ["i"] = Vg([[(0.8, 2.5), (0.8, 8)], [(0.8, 0.3), (0.8, 0.5)]]),
        ["j"] = Vg([Concat([(1.6, 2.5), (1.6, 8.6)], Arc(0.2, 8.6, 1.4, 1.4, 0, 100)), [(1.6, 0.3), (1.6, 0.5)]]),
        ["k"] = Vg([[(0, 0), (0, 8)], [(3.8, 2.5), (0, 5.8)], [(1.4, 4.7), (4, 8)]]),
        ["l"] = Vg([[(0.8, 0), (0.8, 8)]]),
        ["m"] = Vg([[(0, 2.5), (0, 8)], Concat(Arc(1.9, 4.4, 1.9, 1.9, 180, 360), [(3.8, 8)]), Concat(Arc(5.7, 4.4, 1.9, 1.9, 180, 360), [(7.6, 8)])]),
        ["n"] = Vg([[(0, 2.5), (0, 8)], Concat(Arc(2.1, 4.6, 2.1, 2.1, 180, 360), [(4.2, 8)])]),
        ["o"] = Vg([Oval(2.3, 5.25, 2.3, 2.75)]),
        ["p"] = Vg([[(0, 2.5), (0, 10)], Oval(2.2, 5.25, 2.2, 2.75)]),
        ["q"] = Vg([Oval(2.2, 5.25, 2.2, 2.75), [(4.4, 2.5), (4.4, 10)]]),
        ["r"] = Vg([[(0, 2.5), (0, 8)], Arc(2.1, 4.6, 2.1, 2.1, 180, 290)]),
        ["s"] = Vg([SCurve(2, 2.5, 5.5)]),
        ["t"] = Vg([Concat([(1.4, 0.8), (1.4, 6.6)], Arc(2.8, 6.6, 1.4, 1.4, 180, 60)), [(0, 2.5), (3.4, 2.5)]]),
        ["u"] = Vg([Concat([(0, 2.5), (0, 5.4)], Arc(2.1, 5.4, 2.1, 2.6, 180, 0)), [(4.2, 2.5), (4.2, 8)]]),
        ["v"] = Vg([[(0, 2.5), (2.2, 8), (4.4, 2.5)]]),
        ["w"] = Vg([[(0, 2.5), (1.5, 8), (3.2, 3.5), (4.9, 8), (6.4, 2.5)]]),
        ["x"] = Vg([[(0, 2.5), (4.2, 8)], [(4.2, 2.5), (0, 8)]]),
        ["y"] = Vg([[(0, 2.5), (2.2, 8)], [(4.4, 2.5), (1.2, 10)]]),
        ["z"] = Vg([[(0, 2.5), (4, 2.5), (0, 8), (4, 8)]]),
        ["0"] = Vg([Oval(2.4, 4, 2.4, 4)]),
        ["1"] = Vg([[(0.4, 1.8), (2.2, 0), (2.2, 8)]]),
        ["2"] = Vg([Concat(Arc(2.3, 2.4, 2.3, 2.4, 180, 390), [(0, 8), (4.8, 8)])]),
        ["3"] = Vg([Concat(Arc(2.2, 2, 2.2, 2, 200, 450), Arc(2.3, 6, 2.4, 2, 270, 520))]),
        ["4"] = Vg([[(3.8, 8), (3.8, 0), (0, 5.8), (5, 5.8)]]),
        ["5"] = Vg([Concat([(4.4, 0), (0.6, 0), (0.4, 3.6)], Arc(2.4, 5.6, 2.4, 2.4, 250, 500))]),
        ["6"] = Vg([Oval(2.4, 5.4, 2.4, 2.6), Bez((0, 5.4), (0, 0.2), (3.6, 0.1))]),
        ["7"] = Vg([[(0, 0), (4.6, 0), (1.6, 8)]]),
        ["8"] = Vg([Oval(2.3, 2.1, 2, 2.1), Oval(2.3, 6, 2.4, 2)]),
        ["9"] = Vg([Oval(2.4, 2.6, 2.4, 2.6), Bez((4.8, 2.6), (4.8, 7.8), (1.2, 7.9))]),
        ["-"] = Vg([[(0, 4.5), (3, 4.5)]]),
        ["_"] = Vg([[(0, 9), (5, 9)]]),
        ["."] = Vg([[(0.6, 7.7), (0.6, 8)]]),
        ["/"] = Vg([[(0, 8), (3.2, 0)]]),
        [" "] = new VGlyph(SpaceAdvance, []),
        [Ellipsis] = Vg([[(0.6, 7.7), (0.6, 8)], [(3, 7.7), (3, 8)], [(5.4, 7.7), (5.4, 8)]]),
        ["?"] = Vg([Concat(Arc(2.2, 2.4, 2.2, 2.4, 180, 400), [(2.2, 5.6)]), [(2.2, 7.7), (2.2, 8)]]),
    };

    /// <summary>Folds accents to base letters, strips control chars, maps unknown chars to '?'.</summary>
    public static string NormalizeBandText(string text)
    {
        var folded = text.Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder(folded.Length);
        foreach (var ch in folded)
        {
            if (ch is >= '\u0300' and <= '\u036f') continue;
            if (ch is >= '\u0000' and <= '\u001f' or >= '\u007f' and <= '\u009f' or '\u2028' or '\u2029') continue;
            builder.Append(ch);
        }
        var result = new System.Text.StringBuilder();
        foreach (var rune in builder.ToString().EnumerateRunes())
        {
            var s = rune.ToString();
            result.Append(VFont.ContainsKey(s) ? s : "?");
        }
        return result.ToString().Trim();
    }

    private static VGlyph VGlyphFor(string ch) => VFont.TryGetValue(ch, out var g) ? g : VFont["?"];

    /// <summary>Width in pixels of text at the given scale (px per font unit), from real advances.</summary>
    public static double MeasureText(string text, double scale)
    {
        var runes = text.EnumerateRunes().ToList();
        if (runes.Count == 0) return 0;
        var units = runes.Sum(r => VGlyphFor(r.ToString()).Adv);
        return (units - FontSpacing) * scale * TextXScale;
    }

    private readonly record struct BandFit(string Text, double Scale);

    /// <summary>Largest scale (down to a floor) where text fits, then ellipsis truncation.</summary>
    private static BandFit FitBandText(string text, double maxWidth)
    {
        var clean = NormalizeBandText(text);
        for (var scale = TextMaxScale; scale >= TextMinScale - 1e-9; scale -= TextScaleStep)
        {
            if (MeasureText(clean, scale) <= maxWidth) return new BandFit(clean, scale);
        }
        var chars = clean.EnumerateRunes().Select(r => r.ToString()).ToList();
        var keep = chars.Count - 1;
        while (keep > 0 && MeasureText(string.Concat(chars.Take(keep)).TrimEnd() + Ellipsis, TextMinScale) > maxWidth) keep--;
        return new BandFit(string.Concat(chars.Take(keep)).TrimEnd() + Ellipsis, TextMinScale);
    }

    private static double DistToSegment(double px, double py, Pt a, Pt b)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var len2 = dx * dx + dy * dy;
        var t = len2 == 0 ? 0 : Math.Max(0, Math.Min(1, ((px - a.X) * dx + (py - a.Y) * dy) / len2));
        return Math.Sqrt(Math.Pow(px - (a.X + t * dx), 2) + Math.Pow(py - (a.Y + t * dy), 2));
    }

    private readonly record struct Clip(int X, int Y, int W, int H);

    /// <summary>
    /// Draws text anti-aliased, clipped to the given rectangle. `x` is the
    /// left edge, `capTop` the y of the cap line, in pixels.
    /// </summary>
    private static void DrawVectorText(byte[] canvas, string text, double x, double capTop, double scale, Rgb rgb, Clip clip, int ss = TextSupersample)
    {
        var half = Math.Max(1.2, 1.4 * scale) / 2;
        var sw = clip.W * ss;
        var sh = clip.H * ss;
        var cover = new bool[sw * sh];
        var cx = x;
        foreach (var rune in text.EnumerateRunes())
        {
            var g = VGlyphFor(rune.ToString());
            foreach (var stroke in g.Strokes)
            {
                var pts = stroke.Select(p => (X: cx + p.X * scale * TextXScale, Y: capTop + p.Y * scale)).ToList();
                for (var i = 0; i < Math.Max(1, pts.Count - 1); i++)
                {
                    var a = pts[i];
                    var b = pts[Math.Min(i + 1, pts.Count - 1)];
                    var x0 = Math.Max(0, (int)Math.Floor((Math.Min(a.X, b.X) - half - clip.X) * ss));
                    var x1 = Math.Min(sw - 1, (int)Math.Ceiling((Math.Max(a.X, b.X) + half - clip.X) * ss));
                    var y0 = Math.Max(0, (int)Math.Floor((Math.Min(a.Y, b.Y) - half - clip.Y) * ss));
                    var y1 = Math.Min(sh - 1, (int)Math.Ceiling((Math.Max(a.Y, b.Y) + half - clip.Y) * ss));
                    for (var sy = y0; sy <= y1; sy++)
                    {
                        for (var sx = x0; sx <= x1; sx++)
                        {
                            var px = clip.X + (sx + 0.5) / ss;
                            var py = clip.Y + (sy + 0.5) / ss;
                            if (DistToSegment(px, py, a, b) <= half) cover[sy * sw + sx] = true;
                        }
                    }
                }
            }
            cx += g.Adv * scale * TextXScale;
        }
        for (var j = 0; j < clip.H; j++)
        {
            for (var i = 0; i < clip.W; i++)
            {
                var n = 0;
                for (var v = 0; v < ss; v++) for (var u = 0; u < ss; u++) if (cover[(j * ss + v) * sw + i * ss + u]) n++;
                if (n == 0) continue;
                var alpha = n / (double)(ss * ss);
                var o = ((clip.Y + j) * FaceSize + clip.X + i) * 4;
                canvas[o] = (byte)Math.Round(canvas[o] * (1 - alpha) + rgb.R * alpha);
                canvas[o + 1] = (byte)Math.Round(canvas[o + 1] * (1 - alpha) + rgb.G * alpha);
                canvas[o + 2] = (byte)Math.Round(canvas[o + 2] * (1 - alpha) + rgb.B * alpha);
            }
        }
    }

    public static byte[] Draw(FaceSpec spec)
    {
        var canvas = NewCanvas();
        // Filled rings reach the stroke's outer edge so every style spans the same box.
        var fillR = RingRadius + RingStroke / 2.0;
        for (var y = RingCy - RingOuter; y <= RingCy + RingOuter; y++)
        {
            for (var x = RingCx - RingOuter; x <= RingCx + RingOuter; x++)
            {
                var dx = x + 0.5 - RingCx;
                var dy = y + 0.5 - RingCy;
                var hit = spec.RingStyle == RingStyle.Filled
                    ? Math.Sqrt(dx * dx + dy * dy) <= fillR
                    : RingPng.Covers(spec.RingStyle, RingCx, RingCy, RingRadius, RingStroke, x + 0.5, y + 0.5);
                if (hit) SetPixel(canvas, x, y, spec.RingRgb);
            }
        }
        if (spec.Tab is { } tab)
        {
            var text = FitText(tab.ToString(), TabMaxChars);
            var tabRgb = spec.RingStyle == RingStyle.Filled ? FaceBg : White;
            var sup = SuperscriptText(spec.TabNumber);
            var textLength = text.EnumerateRunes().Count();
            if (sup is not null)
            {
                var layout = LayoutWithSuperscript(textLength, sup.EnumerateRunes().Count());
                DrawText(canvas, text, layout.MainX, layout.MainY, layout.MainScale, tabRgb);
                DrawText(canvas, sup, layout.SupX, layout.SupY, SupScale, tabRgb);
            }
            else
            {
                var scale = textLength < TabScales.Length ? TabScales[textLength] : 3;
                var width = (textLength * 4 - 1) * scale;
                DrawText(canvas, text, (int)Math.Round(RingCx - width / 2.0), (int)Math.Round(RingCy - 5 * scale / 2.0), scale, tabRgb);
            }
        }
        if (!string.IsNullOrEmpty(spec.Project))
        {
            FillRect(canvas, 0, BandY, FaceSize, BandHeight, spec.Band);
            var fit = FitBandText(spec.Project, FaceSize - 2 * BandPad);
            var x = BandPad + (FaceSize - 2 * BandPad - MeasureText(fit.Text, fit.Scale)) / 2;
            // Centre cap line plus descenders (10 font units) so g/p/y fit inside the band.
            var capTop = BandY + (BandHeight - 10 * fit.Scale) / 2;
            DrawVectorText(canvas, fit.Text, x, capTop, fit.Scale, White, new Clip(0, BandY, FaceSize, BandHeight));
        }
        return RingPng.Encode(FaceSize, FaceSize, canvas);
    }
}

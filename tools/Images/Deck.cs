using System.Buffers.Binary;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Text;

namespace Herdr.Images;

// Renders the README's key-face images: the keypad with nine live tiles in it,
// and a strip of the seven tile states. The rings are the plugin's own PNGs,
// drawn by the same code that answers the device, so the pictures cannot drift
// from what the keypad shows. Labels go through LabelText() as well; only the
// key face around them is this tool's own approximation of how Options+ draws
// an icon with its title underneath.
//
// assets/keypad-frame.png is a rendering of the keypad whose nine key windows
// are transparent, so the faces are drawn underneath it and the frame supplies
// the bezels and their gloss on top.
//
// Rasterising the SVG needs librsvg (`brew install librsvg`) or ImageMagick.
// Without either, the SVG is written instead and can be converted anywhere.
static class Deck
{
    // One key face in design units: the ring at the size the device receives it,
    // with room for the label underneath.
    private const double TileSize = 120;
    private const double RingTop = 12;
    private const double LabelBaseline = TileSize - 17;
    private const double LabelSize = 15;

    private const string Face = "#000000";
    private const string Bezel = "#212226";
    private const string LabelColour = "#e7e7e9";
    private const string Font = "'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif";

    // `Project` is null for the old-style ring-plus-label approximation (used
    // by the state legend strip) and non-null (possibly empty) for the new
    // composite key face, drawn by the same FacePng.Draw() the device uses.
    private sealed record Key(string Status, string Label, int? Tab = null, string? Project = null);

    private sealed record Window(int X, int Y, int Width, int Height);

    // A plausible herdr session: six workspaces open, one waiting on you, two
    // agents at work, one turn just finished, and three slots still empty.
    private static readonly Key[] DemoDeck =
    [
        new("blocked", "fix-login", Tab: 1, Project: "fix-login"),
        new("working", "refactor-auth", Tab: 2, Project: "refactor-auth"),
        new("done", "migrate-db", Tab: 3, Project: "migrate-db"),
        new("working", "add-tests", Tab: 4, Project: "add-tests"),
        new("idle", "review-pr", Tab: 5, Project: "review-pr"),
        new("unknown", "bench", Tab: 6, Project: "bench"),
        new("none", "Space 7", Tab: 7, Project: ""),
        new("none", "Space 8", Tab: 8, Project: ""),
        new("none", "Space 9", Tab: 9, Project: ""),
    ];

    private static readonly Key[] States =
    [
        new("blocked", "blocked"),
        new("working", "working"),
        new("done", "done"),
        new("idle", "idle"),
        new("unknown", "unknown"),
        new("none", "empty"),
        new("offline", "offline"),
    ];

    private static string N(double value) => value.ToString(CultureInfo.InvariantCulture);

    // Each ring is encoded once per size and reused by every tile showing that
    // status. Drawing it at the pixel size it will occupy keeps it sharp instead
    // of letting the renderer scale it.
    private static readonly Dictionary<string, string> Rings = [];

    private static string Ring(string status, int pixels)
    {
        var key = $"{status}@{pixels}";
        if (!Rings.TryGetValue(key, out var cached))
        {
            var (rgb, style) = TileFaces.StyleFor(status);
            cached = Convert.ToBase64String(RingPng.Circle(pixels, rgb, style));
            Rings[key] = cached;
        }
        return cached;
    }

    // The new composite key face (ring, tab number/superscript and project
    // band), drawn by FacePng.Draw() — the same code the device uses — and
    // cached per distinct (status, tab, project) combination.
    private static readonly Dictionary<string, string> Faces = [];

    private static string FaceImage(Key key)
    {
        var cacheKey = $"{key.Status}|{key.Tab}|{key.Project}";
        if (!Faces.TryGetValue(cacheKey, out var cached))
        {
            var (rgb, style) = TileFaces.StyleFor(key.Status);
            var spec = new FaceSpec
            {
                Tab = key.Tab,
                Project = key.Project ?? "",
                RingRgb = rgb,
                RingStyle = style,
                Band = ProjectColor.For(key.Project ?? ""),
            };
            cached = Convert.ToBase64String(FacePng.Draw(spec));
            Faces[cacheKey] = cached;
        }
        return cached;
    }

    private static string DataUri(string base64) => $"data:image/png;base64,{base64}";

    // The frame's key windows are holes in its alpha channel, so the layout is
    // read from the image rather than written down here: replace the frame and the
    // faces still land in its windows.
    private static (int Width, int Height, byte[] Alpha) AlphaChannel(byte[] png, string path)
    {
        if (BinaryPrimitives.ReadUInt32BigEndian(png) != 0x89504e47) throw new InvalidDataException($"{path} is not a PNG");
        int width = 0, height = 0;
        using var idat = new MemoryStream();
        for (var at = 8; at + 8 <= png.Length;)
        {
            var length = (int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(at));
            var type = Encoding.ASCII.GetString(png, at + 4, 4);
            var body = png.AsSpan(at + 8, length);
            if (type == "IHDR")
            {
                width = (int)BinaryPrimitives.ReadUInt32BigEndian(body);
                height = (int)BinaryPrimitives.ReadUInt32BigEndian(body[4..]);
                if (body[8] != 8 || body[9] != 6 || body[12] != 0)
                {
                    throw new InvalidDataException($"{path} must be a non-interlaced 8-bit RGBA PNG, with the key windows transparent");
                }
            }
            else if (type == "IDAT") idat.Write(body);
            else if (type == "IEND") break;
            at += 12 + length;
        }

        idat.Position = 0;
        using var inflated = new MemoryStream();
        using (var zlib = new ZLibStream(idat, CompressionMode.Decompress)) zlib.CopyTo(inflated);
        var raw = inflated.ToArray();
        var stride = width * 4;
        var pixels = new byte[stride * height];
        // Undo the per-scanline filters; only the alpha byte of each pixel is kept,
        // but filtering refers to whole pixels, so every channel is reconstructed.
        for (var y = 0; y < height; y++)
        {
            var filter = raw[y * (stride + 1)];
            var line = y * (stride + 1) + 1;
            for (var x = 0; x < stride; x++)
            {
                int a = x >= 4 ? pixels[y * stride + x - 4] : 0;
                int b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
                int c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
                int value = raw[line + x];
                if (filter == 1) value += a;
                else if (filter == 2) value += b;
                else if (filter == 3) value += (a + b) >> 1;
                else if (filter == 4)
                {
                    var p = a + b - c;
                    int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
                    value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                }
                pixels[y * stride + x] = (byte)value;
            }
        }
        var alpha = new byte[width * height];
        for (var i = 0; i < alpha.Length; i++) alpha[i] = pixels[i * 4 + 3];
        return (width, height, alpha);
    }

    // Runs of consecutive indices whose count clears the threshold, which turn the
    // holes into three key rows and, within a row, three key columns.
    private static List<(int Start, int End)> Bands(int[] counts, int threshold)
    {
        var found = new List<(int, int)>();
        var start = -1;
        for (var i = 0; i < counts.Length; i++)
        {
            if (counts[i] > threshold && start < 0) start = i;
            else if (counts[i] <= threshold && start >= 0)
            {
                found.Add((start, i - 1));
                start = -1;
            }
        }
        if (start >= 0) found.Add((start, counts.Length - 1));
        return found;
    }

    private static List<Window> KeyWindows(int width, int height, byte[] alpha, string path)
    {
        bool Opaque(int x, int y) => alpha[y * width + x] > 128;
        // A hole only counts where the body encloses it, so the transparent
        // background around the keypad and its rounded corners are ignored.
        var hole = new bool[width * height];
        for (var y = 0; y < height; y++)
        {
            int first = -1, last = -1;
            for (var x = 0; x < width; x++)
            {
                if (!Opaque(x, y)) continue;
                if (first < 0) first = x;
                last = x;
            }
            for (var x = first + 1; x < last; x++) hole[y * width + x] = !Opaque(x, y);
        }

        var rowCounts = Enumerable.Range(0, height)
            .Select(y => Enumerable.Range(0, width).Count(x => hole[y * width + x]))
            .ToArray();
        var rows = Bands(rowCounts, 30);
        if (rows.Count != 3) throw new InvalidDataException($"expected 3 rows of key windows in {path}, found {rows.Count}");

        var windows = new List<Window>();
        foreach (var (top, bottom) in rows)
        {
            var columnCounts = Enumerable.Range(0, width)
                .Select(x => Enumerable.Range(top, bottom - top + 1).Count(y => hole[y * width + x]))
                .ToArray();
            var columns = Bands(columnCounts, 10);
            if (columns.Count != 3) throw new InvalidDataException($"expected 3 key windows in a row of {path}, found {columns.Count}");
            windows.AddRange(columns.Select(c => new Window(c.Start, top, c.End - c.Start + 1, bottom - top + 1)));
        }
        return windows;
    }

    // One key face, `scale` pixels per design unit, with its top-left corner at
    // (x, y). An empty slot keeps the space its label would occupy so the rows
    // stay aligned, which is what the device does too.
    private static string KeyFace(Key key, double x, double y, double scale, bool rounded = false)
    {
        var size = TileSize * scale;
        if (key.Project is not null)
        {
            // A full 80x80 key face, drawn by the same FacePng.Draw() the
            // device uses (tab, state ring and the project's own band
            // colour), not approximated.
            var facePixels = (int)Math.Round(size);
            return $"""

                  <g transform="translate({N(x)},{N(y)})">
                    <image x="0" y="0" width="{facePixels}" height="{facePixels}" href="{DataUri(FaceImage(key))}"/>
                  </g>
                """;
        }
        var ringPixels = (int)Math.Round(TileFaces.ImageSize * scale);
        var text = TileFaces.LabelText(key.Label).Trim('​', ' ');
        var plate = rounded
            ? $"""<rect width="{N(size)}" height="{N(size)}" rx="{N(16 * scale)}" fill="{Face}" stroke="{Bezel}" stroke-width="{N(scale)}"/>"""
            : $"""<rect width="{N(size)}" height="{N(size)}" fill="{Face}"/>""";
        var label = text.Length == 0
            ? ""
            : $"""<text x="{N(size / 2)}" y="{N(LabelBaseline * scale)}" text-anchor="middle" font-family="{Font}" font-size="{N(LabelSize * scale)}" fill="{LabelColour}">{WebUtility.HtmlEncode(text)}</text>""";
        return $"""

              <g transform="translate({N(x)},{N(y)})">
                {plate}
                <image x="{N((size - ringPixels) / 2)}" y="{N(RingTop * scale)}" width="{ringPixels}" height="{ringPixels}" href="{DataUri(Ring(key.Status, ringPixels))}"/>
                {label}
              </g>
            """;
    }

    // The nine faces sit in the frame's key windows and the frame goes on top, so
    // its bezels clip them and its gloss falls over them. The face is scaled to
    // the window's width and centred in its slightly taller opening, which keeps
    // the ring round.
    private static string Keypad(IReadOnlyList<Key> keys, string framePath)
    {
        var png = File.ReadAllBytes(framePath);
        var (width, height, alpha) = AlphaChannel(png, framePath);
        var windows = KeyWindows(width, height, alpha, framePath);
        var faces = string.Concat(keys.Select((key, i) =>
        {
            var window = windows[i];
            var scale = window.Width / TileSize;
            return KeyFace(key, window.X, window.Y + (window.Height - TileSize * scale) / 2, scale);
        }));
        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{faces}
              <image x="0" y="0" width="{width}" height="{height}" href="{DataUri(Convert.ToBase64String(png))}"/>
            </svg>

            """;
    }

    // The legend strip: the same faces, standing on their own rather than in the
    // keypad, because offline and empty never share a deck with the other states.
    private static string Strip(IReadOnlyList<Key> keys, double scale = 2)
    {
        var size = TileSize * scale;
        var gap = 10 * scale;
        var width = keys.Count * size + (keys.Count - 1) * gap;
        var faces = string.Concat(keys.Select((key, i) => KeyFace(key, i * (size + gap), 0, scale, rounded: true)));
        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{N(width)}" height="{N(size)}" viewBox="0 0 {N(width)} {N(size)}">{faces}
            </svg>

            """;
    }

    // librsvg renders at exactly the requested size and honours the embedded PNGs;
    // ImageMagick is the fallback. QuickLook is deliberately not used: it insets
    // and rescales the drawing.
    private static string Rasterise(string svg, string output)
    {
        var scratch = Path.Combine(Path.GetTempPath(), $"herdr-deck-{Environment.ProcessId}.svg");
        File.WriteAllText(scratch, svg);
        try
        {
            foreach (var (command, arguments) in new[] { ("rsvg-convert", new[] { scratch, "-o", output }), ("magick", new[] { scratch, output }) })
            {
                var start = new ProcessStartInfo(command) { RedirectStandardError = true };
                foreach (var argument in arguments) start.ArgumentList.Add(argument);
                Process process;
                try
                {
                    process = Process.Start(start)!;
                }
                catch (Win32Exception)
                {
                    continue; // not installed
                }
                using (process)
                {
                    var errors = process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new InvalidOperationException($"{command} failed: {errors}");
                }
                return output;
            }
        }
        finally
        {
            File.Delete(scratch);
        }
        var fallback = Path.ChangeExtension(output, ".svg");
        File.WriteAllText(fallback, svg);
        Console.Error.WriteLine(
            $"No SVG rasteriser found, so {fallback} was written instead of the PNG. Install one with: brew install librsvg");
        return fallback;
    }

    // --live reads the running herdr through the plugin's own tile classes, so a
    // picture of a real session goes through exactly the code path the device
    // does. Without herdr running every tile would be offline, which says nothing,
    // so that is an error rather than a picture.
    private static async Task<Key[]?> LiveDeckAsync()
    {
        var client = new HerdrClient();
        Snapshot snapshot;
        try
        {
            snapshot = await client.GetSnapshotAsync();
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"--live needs herdr running: {e.Message}");
            return null;
        }
        return Enumerable.Range(1, Tile.SlotCount).Select(slot =>
        {
            var tile = new SpaceTile(client, slot);
            tile.Update(snapshot);
            return new Key(tile.Status, tile.Label, tile.Face.Tab, tile.Face.Project);
        }).ToArray();
    }

    public static async Task<int> WriteAsync(string root, bool live)
    {
        var deck = live ? await LiveDeckAsync() : DemoDeck;
        if (deck is null) return 1;

        var outDir = Path.Combine(root, "docs/images");
        Directory.CreateDirectory(outDir);
        foreach (var (name, svg) in new[] { ("keypad", Keypad(deck, Path.Combine(root, "assets/keypad-frame.png"))), ("tile-states", Strip(States)) })
        {
            var written = Rasterise(svg, Path.Combine(outDir, $"{name}.png"));
            Console.WriteLine($"wrote {Path.GetRelativePath(root, written)}");
        }
        return 0;
    }
}

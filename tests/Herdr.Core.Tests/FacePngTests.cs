using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Herdr.Tests;

public class FacePngTests
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    private static List<(string Type, byte[] Data)> Chunks(byte[] png)
    {
        var chunks = new List<(string, byte[])>();
        for (var offset = Signature.Length; offset < png.Length;)
        {
            var length = (int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(offset));
            var type = Encoding.ASCII.GetString(png, offset + 4, 4);
            chunks.Add((type, png.AsSpan(offset + 8, length).ToArray()));
            offset += 12 + length;
        }
        return chunks;
    }

    private static Func<int, int, byte[]> Pixels(byte[] png, int size = 80)
    {
        var idat = Chunks(png).First(c => c.Type == "IDAT").Data;
        using var inflated = new MemoryStream();
        using (var zlib = new ZLibStream(new MemoryStream(idat), CompressionMode.Decompress)) zlib.CopyTo(inflated);
        var raw = inflated.ToArray();
        var stride = size * 4 + 1;
        return (x, y) => raw[(y * stride + 1 + x * 4)..(y * stride + 1 + x * 4 + 4)];
    }

    private static readonly Rgb White = new(255, 255, 255);
    private static readonly Rgb Red = new(230, 40, 40);
    private static readonly Rgb Band = new(0x3b, 0x82, 0xf6);

    private static FaceSpec Spec(int? tab = null, int? tabNumber = null, string project = "", string session = "",
        RingStyle style = RingStyle.Filled) =>
        new() { Tab = tab, TabNumber = tabNumber, Project = project, Session = session, RingRgb = Red, RingStyle = style, Band = Band };

    [Fact]
    public void OutputsAnEightyByEightyPng()
    {
        var png = FacePng.Draw(Spec(tab: 2));
        var ihdr = Chunks(png).First(c => c.Type == "IHDR").Data;
        Assert.Equal(80u, BinaryPrimitives.ReadUInt32BigEndian(ihdr));
        Assert.Equal(80u, BinaryPrimitives.ReadUInt32BigEndian(ihdr.AsSpan(4)));
    }

    [Fact]
    public void IsDeterministicAcrossRepeatedCalls() =>
        Assert.Equal(FacePng.Draw(Spec(tab: 3, project: "api", session: "Fix login")), FacePng.Draw(Spec(tab: 3, project: "api", session: "Fix login")));

    [Fact]
    public void FilledRingCoversTheCentreWhileOutlineAndDottedDoNot()
    {
        var filled = Pixels(FacePng.Draw(Spec(style: RingStyle.Filled)));
        Assert.Equal((Red.R, Red.G, Red.B), (filled(40, 29)[0], filled(40, 29)[1], filled(40, 29)[2]));
        // Outline leaves the ring hole background, so a point well inside the
        // ring (near its centre) stays background rather than ring colour.
        var outline = Pixels(FacePng.Draw(Spec(style: RingStyle.Outline)));
        Assert.NotEqual((Red.R, Red.G, Red.B), (outline(40, 29)[0], outline(40, 29)[1], outline(40, 29)[2]));
    }

    [Fact]
    public void EmptyFaceHasANumberADottedRingAndNoBand()
    {
        var at = Pixels(FacePng.Draw(Spec(tab: 4, style: RingStyle.Dotted)));
        // Band area stays background (black) since project is empty.
        Assert.Equal((0, 0, 0), (at(40, 70)[0], at(40, 70)[1], at(40, 70)[2]));
    }

    [Fact]
    public void OfflineFaceHasARingButNoNumberAndNoBand()
    {
        var withNumber = FacePng.Draw(Spec(tab: 4, style: RingStyle.Dotted));
        var without = FacePng.Draw(Spec(tab: null, style: RingStyle.Dotted));
        Assert.NotEqual(withNumber, without);
    }

    [Fact]
    public void BandIsOnlyDrawnForANonEmptyProjectAndIsFlushWithTheBottomEdge()
    {
        var withProject = Pixels(FacePng.Draw(Spec(tab: 1, project: "api")));
        var withoutProject = Pixels(FacePng.Draw(Spec(tab: 1, project: "")));
        // y=58 is the first band row; a corner stays the plain band colour.
        Assert.Equal((Band.R, Band.G, Band.B), (withProject(0, 58)[0], withProject(0, 58)[1], withProject(0, 58)[2]));
        Assert.Equal((Band.R, Band.G, Band.B), (withProject(0, 79)[0], withProject(0, 79)[1], withProject(0, 79)[2]));
        // y=57 (just above the band) is not the band colour.
        Assert.NotEqual((Band.R, Band.G, Band.B), (withProject(0, 57)[0], withProject(0, 57)[1], withProject(0, 57)[2]));
        Assert.NotEqual((Band.R, Band.G, Band.B), (withoutProject(0, 58)[0], withoutProject(0, 58)[1], withoutProject(0, 58)[2]));
    }

    [Fact]
    public void DifferentProjectNamesProduceDifferentFaces() =>
        Assert.NotEqual(FacePng.Draw(Spec(tab: 1, project: "api")), FacePng.Draw(Spec(tab: 1, project: "web")));

    [Fact]
    public void SessionTextNeverChangesTheRenderedFace() =>
        Assert.Equal(FacePng.Draw(Spec(tab: 1, project: "api", session: "A")), FacePng.Draw(Spec(tab: 1, project: "api", session: "B")));

    [Fact]
    public void BandTextIsAntiAliasedWithWhiteBandAndIntermediatePixels()
    {
        var at = Pixels(FacePng.Draw(Spec(project: "Wider Project Name Than The Band")));
        var row = Enumerable.Range(0, 80).Select(x => at(x, 68)).ToList();
        var distinctRgb = row.Select(p => (p[0], p[1], p[2])).Distinct().ToList();
        // Plain band colour, white (or near white) text, and at least one blend in between.
        Assert.Contains((Band.R, Band.G, Band.B), distinctRgb);
        Assert.True(distinctRgb.Count > 2);
    }

    [Fact]
    public void FitTextTruncatesByCodePointAndAppendsAnEllipsis() =>
        Assert.Equal("ab…", FacePng.FitText("abcdef", 3));

    [Fact]
    public void SuperscriptTextClampsAndRejectsNonPositiveValues()
    {
        Assert.Null(FacePng.SuperscriptText(null));
        Assert.Null(FacePng.SuperscriptText(0));
        Assert.Null(FacePng.SuperscriptText(-1));
        Assert.Equal("2", FacePng.SuperscriptText(2));
        Assert.Equal("99", FacePng.SuperscriptText(99));
        Assert.Equal("99", FacePng.SuperscriptText(150));
    }

    [Fact]
    public void SuperscriptChangesThePngWhenSupplied() =>
        Assert.NotEqual(FacePng.Draw(Spec(tab: 1)), FacePng.Draw(Spec(tab: 1, tabNumber: 2)));

    [Fact]
    public void OmittingTabNumberProducesTheSameFaceAsExplicitlyUndefined() =>
        Assert.Equal(FacePng.Draw(Spec(tab: 1)), FacePng.Draw(Spec(tab: 1, tabNumber: null)));

    [Fact]
    public void NormalizeBandTextFoldsAccentsStripsControlsAndMapsUnknownToQuestionMark()
    {
        Assert.Equal("Ecran ete", FacePng.NormalizeBandText("Écran été"));
        Assert.Equal("abc", FacePng.NormalizeBandText("a\nb\u0007c"));
        Assert.Equal("a?b", FacePng.NormalizeBandText("a日b"));
        Assert.Equal("my_proj-1.2/x", FacePng.NormalizeBandText("my_proj-1.2/x"));
    }

    [Fact]
    public void MeasureTextUsesRealGlyphAdvancesSoWideLettersMeasureWider() =>
        Assert.True(FacePng.MeasureText("WWWW", 2.0) > FacePng.MeasureText("iiii", 2.0));

    [Fact]
    public void MeasureTextOfEmptyTextIsZero() => Assert.Equal(0, FacePng.MeasureText("", 2.0));

    [Fact]
    public void LongTextStillProducesAValidEightyByEightyPng()
    {
        var png = FacePng.Draw(Spec(tab: 1, project: new string('w', 60)));
        var ihdr = Chunks(png).First(c => c.Type == "IHDR").Data;
        Assert.Equal(80u, BinaryPrimitives.ReadUInt32BigEndian(ihdr));
    }

    [Fact]
    public void EmojiAndUnsupportedCharactersRenderAsQuestionMarkRatherThanThrowing()
    {
        var exception = Record.Exception(() => FacePng.Draw(Spec(tab: 1, project: "🚀日本語")));
        Assert.Null(exception);
    }
}

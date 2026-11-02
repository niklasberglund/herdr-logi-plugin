using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Herdr.Tests;

public class TabIconPngTests
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

    private static Func<int, int, byte[]> Pixels(byte[] png, int size)
    {
        var idat = Chunks(png).First(c => c.Type == "IDAT").Data;
        using var inflated = new MemoryStream();
        using (var zlib = new ZLibStream(new MemoryStream(idat), CompressionMode.Decompress)) zlib.CopyTo(inflated);
        var raw = inflated.ToArray();
        var stride = size * 4 + 1;
        return (x, y) => raw[(y * stride + 1 + x * 4)..(y * stride + 1 + x * 4 + 4)];
    }

    [Fact]
    public void EncodesAWellFormedRgbaPngOfTheRequestedSize()
    {
        var png = TabIconPng.Draw(80);
        Assert.Equal(Signature, png[..8]);
        var ihdr = Chunks(png).First(c => c.Type == "IHDR").Data;
        Assert.Equal(80u, BinaryPrimitives.ReadUInt32BigEndian(ihdr));
        Assert.Equal(80u, BinaryPrimitives.ReadUInt32BigEndian(ihdr.AsSpan(4)));
    }

    [Fact]
    public void DrawsAPurplePlusAndTabAccentWithoutAStatusRing()
    {
        var at = Pixels(TabIconPng.Draw(80), 80);

        // The plus sits in the body's centre, in the purple accent colour.
        var centre = at(40, 44);
        Assert.Equal(255, centre[3]);
        Assert.Equal((TabIconPng.Accent.R, TabIconPng.Accent.G, TabIconPng.Accent.B), (centre[0], centre[1], centre[2]));

        // The tab flag (top-right accent) is also purple.
        var tab = at(52, 20);
        Assert.Equal(255, tab[3]);
        Assert.Equal((TabIconPng.Accent.R, TabIconPng.Accent.G, TabIconPng.Accent.B), (tab[0], tab[1], tab[2]));

        // No ring: the area that a status ring would occupy (near the edge,
        // away from the body and the tab flag) stays transparent.
        Assert.Equal(0, at(5, 5)[3]);

        // The body outline itself is white, not an accent colour.
        var leftEdge = at(18, 44);
        Assert.Equal(255, leftEdge[3]);
        Assert.Equal((255, 255, 255), (leftEdge[0], leftEdge[1], leftEdge[2]));
    }

    [Fact]
    public void IsIdenticalRegardlessOfInput()
    {
        // The Tabs tile shows this face no matter the workspace status.
        Assert.Equal(TabIconPng.Draw(80), TabIconPng.Draw(80));
    }
}

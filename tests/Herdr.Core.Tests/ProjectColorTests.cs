namespace Herdr.Tests;

public class ProjectColorTests
{
    [Fact]
    public void IsDeterministicForTheSameName()
    {
        Assert.Equal(ProjectColor.For("api"), ProjectColor.For("api"));
        Assert.Equal(ProjectColor.For("api"), ProjectColor.For("api"));
    }

    [Fact]
    public void IsCaseAndWhitespaceInsensitive()
    {
        Assert.Equal(ProjectColor.For("api"), ProjectColor.For("API"));
        Assert.Equal(ProjectColor.For("api"), ProjectColor.For("  api  "));
    }

    [Fact]
    public void DefaultsForEmptyOrBlankNames()
    {
        Assert.Equal(ProjectColor.Default, ProjectColor.For(""));
        Assert.Equal(ProjectColor.Default, ProjectColor.For("   "));
    }

    [Fact]
    public void DifferentNamesTypicallyProduceDifferentColours() =>
        Assert.NotEqual(ProjectColor.For("api"), ProjectColor.For("web"));

    [Fact]
    public void AlwaysReturnsAColourFromThePalette()
    {
        Rgb[] palette =
        [
            new(0x3b, 0x82, 0xf6), new(0x8b, 0x5c, 0xf6), new(0xd9, 0x46, 0xef), new(0x05, 0xa2, 0xbd),
            new(0xde, 0x7a, 0x38), new(0xe3, 0x6a, 0xa9), new(0x12, 0xa6, 0x95),
        ];
        foreach (var name in new[] { "api", "web", "herdr", "docs", "mobile", "infra", "design", "" })
        {
            Assert.Contains(ProjectColor.For(name), palette);
        }
    }
}

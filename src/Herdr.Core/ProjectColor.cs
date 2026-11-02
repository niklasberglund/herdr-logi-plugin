namespace Herdr;

// Deterministic project-name -> band colour, so the same workspace always
// shows the same colour across polls and plugin restarts.
public static class ProjectColor
{
    public static readonly Rgb Default = new(0x3b, 0x82, 0xf6);

    // Palette avoids the state-ring red/yellow/green hues. Four entries were
    // darkened from their original hue so white band text keeps WCAG contrast
    // >= 3.0 (cyan #06b6d4, orange #e07b39, pink #f472b6, teal #14b8a6).
    private static readonly Rgb[] Palette =
    [
        new(0x3b, 0x82, 0xf6),
        new(0x8b, 0x5c, 0xf6),
        new(0xd9, 0x46, 0xef),
        new(0x05, 0xa2, 0xbd),
        new(0xde, 0x7a, 0x38),
        new(0xe3, 0x6a, 0xa9),
        new(0x12, 0xa6, 0x95),
    ];

    // FNV-1a 32-bit over UTF-16 code units, matching the TypeScript original
    // bit for bit (unsigned 32-bit multiplication instead of Math.imul).
    public static Rgb For(string name)
    {
        var trimmed = (name ?? "").Trim().ToLowerInvariant();
        if (trimmed.Length == 0) return Default;
        var hash = 0x811c9dc5u;
        foreach (var ch in trimmed)
        {
            hash ^= ch;
            hash = unchecked(hash * 0x01000193u);
        }
        return Palette[(int)(hash % (uint)Palette.Length)];
    }
}

namespace Herdr;

// Renders the Tabs tile face: a tab/document outline with a plus and a purple
// accent corner. Deliberately not a status ring (filled, outline or dotted
// circle) so it cannot be mistaken for an agent indicator; the same face is
// used regardless of status.
public static class TabIconPng
{
    // Herdr's purple brand accent, #CBA6F7.
    public static readonly Rgb Accent = new(203, 166, 247);

    // Signed distance to the edge of an axis-aligned rounded box: negative
    // inside, positive outside, zero on the boundary.
    private static double RoundedBoxSdf(double px, double py, double cx, double cy, double halfWidth, double halfHeight, double radius)
    {
        var qx = Math.Abs(px - cx) - (halfWidth - radius);
        var qy = Math.Abs(py - cy) - (halfHeight - radius);
        var ox = Math.Max(qx, 0);
        var oy = Math.Max(qy, 0);
        return Math.Min(Math.Max(qx, qy), 0) + Math.Sqrt(ox * ox + oy * oy) - radius;
    }

    public static byte[] Draw(int size)
    {
        var scale = size / 80.0;

        double bodyX0 = 18 * scale, bodyY0 = 26 * scale, bodyX1 = 62 * scale, bodyY1 = 60 * scale;
        var bodyRadius = 6 * scale;
        var bodyStroke = 6 * scale;
        var bodyCx = (bodyX0 + bodyX1) / 2;
        var bodyCy = (bodyY0 + bodyY1) / 2;
        var bodyHalfW = (bodyX1 - bodyX0) / 2;
        var bodyHalfH = (bodyY1 - bodyY0) / 2;

        // The tab flag: a filled purple rounded rect sitting astride the
        // body's top edge, like a folder tab or bookmark corner.
        double tabX0 = 42 * scale, tabY0 = 16 * scale, tabX1 = 62 * scale, tabY1 = 27 * scale;
        var tabRadius = 4 * scale;
        var tabCx = (tabX0 + tabX1) / 2;
        var tabCy = (tabY0 + tabY1) / 2;
        var tabHalfW = (tabX1 - tabX0) / 2;
        var tabHalfH = (tabY1 - tabY0) / 2;

        var plusCx = bodyCx;
        var plusCy = bodyCy + 2 * scale;
        var plusArm = 12 * scale;
        var plusThickness = 6 * scale;

        var rgba = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size; x++)
            {
                var px = x + 0.5;
                var py = y + 0.5;
                var o = (y * size + x) * 4;

                var onTab = RoundedBoxSdf(px, py, tabCx, tabCy, tabHalfW, tabHalfH, tabRadius) <= 0;
                var onPlus = (Math.Abs(px - plusCx) <= plusArm && Math.Abs(py - plusCy) <= plusThickness / 2)
                    || (Math.Abs(py - plusCy) <= plusArm && Math.Abs(px - plusCx) <= plusThickness / 2);
                var onBodyOutline = Math.Abs(RoundedBoxSdf(px, py, bodyCx, bodyCy, bodyHalfW, bodyHalfH, bodyRadius)) <= bodyStroke / 2;

                if (onTab || onPlus)
                {
                    rgba[o] = Accent.R;
                    rgba[o + 1] = Accent.G;
                    rgba[o + 2] = Accent.B;
                    rgba[o + 3] = 255;
                }
                else if (onBodyOutline)
                {
                    rgba[o] = 255;
                    rgba[o + 1] = 255;
                    rgba[o + 2] = 255;
                    rgba[o + 3] = 255;
                }
                else
                {
                    rgba[o + 3] = 0;
                }
            }
        }
        return RingPng.Encode(size, size, rgba);
    }
}

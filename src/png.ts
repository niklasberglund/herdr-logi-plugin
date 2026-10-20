import { deflateSync } from 'zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export type Rgb = [number, number, number];

export type CircleStyle = 'filled' | 'outline' | 'dotted';

const DOTS = 10;

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Whether a point at offset (dx, dy) from the ring centre is covered by the ring. */
function ringHit(dx: number, dy: number, r: number, stroke: number, style: CircleStyle): boolean {
  const d = Math.hypot(dx, dy);
  const onRing = Math.abs(d - r) <= stroke / 2;
  // Each dot covers the first half of its slice of the circumference.
  const phase = ((Math.atan2(dy, dx) / (2 * Math.PI)) * DOTS + DOTS) % 1;
  return style === 'filled' ? d <= r : style === 'outline' ? onRing : onRing && phase < 0.5;
}

/** Whether pixel (x, y) of a size x size ring canvas is covered by the ring. */
function ringCovers(size: number, x: number, y: number, style: CircleStyle): boolean {
  const c = size / 2;
  return ringHit(x + 0.5 - c, y + 0.5 - c, size * 0.35, size * 0.08, style);
}

export function circlePng(size: number, rgb: Rgb, style: CircleStyle): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = ringCovers(size, x, y, style) ? 255 : 0;
    }
  }
  return encodePng(size, size, rgba);
}

// ---- Key face renderer -------------------------------------------------
// Sizes are candidates, confirmed later on the real MX Keypad.

const FACE_SIZE = 80;
const FACE_BG: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const DEFAULT_BAND: Rgb = [0x3b, 0x82, 0xf6];
// Band: full width, flush to the bottom edge (y=58..79), holding the project name.
export const BAND_Y = 58;
export const BAND_HEIGHT = 22;
// Ring: centre (40, 29), outer diameter 56 px (x 12..68, y 1..57), stroke 6, above the band.
export const RING_CX = 40;
export const RING_CY = 29;
export const RING_RADIUS = 25;
export const RING_STROKE = 6;
const RING_OUTER = Math.ceil(RING_RADIUS + RING_STROKE / 2);
// Tab number: centred in the ring hole (radius 22); scale 7 for one digit, 4 for two, 3 for three.
// Filled rings knock the digits out in the background colour; outline/dotted use white.
const TAB_SCALES = [7, 7, 4, 3];
const TAB_MAX_CHARS = 3;
// Superscript (tab position in its space): scale 2 = 10 px caps, up to 2 digits (99), dropped
// SUP_DROP px with the main number, raised SUP_RAISE px above its top, SUP_GAP px to its right.
const SUP_SCALE = 2;
const SUP_GAP = 2;
const SUP_RAISE = 3;
const SUP_DROP = 2;
const SUP_FIT_RADIUS = 21.5;
const BAND_PAD = 3;

const ELLIPSIS = '\u2026';

function glyph(rows: string): number[] {
  return rows.split(',').map((r) => parseInt(r, 2));
}

// Five rows of three bits (leftmost bit = left column).
const FONT = new Map<string, number[]>([
  ['0', glyph('111,101,101,101,111')],
  ['1', glyph('010,110,010,010,111')],
  ['2', glyph('111,001,111,100,111')],
  ['3', glyph('111,001,111,001,111')],
  ['4', glyph('101,101,111,001,001')],
  ['5', glyph('111,100,111,001,111')],
  ['6', glyph('111,100,111,101,111')],
  ['7', glyph('111,001,010,010,010')],
  ['8', glyph('111,101,111,101,111')],
  ['9', glyph('111,101,111,001,111')],
  [' ', glyph('000,000,000,000,000')],
  [ELLIPSIS, glyph('000,000,000,000,101')],
]);

// The image only ever draws the tab number; anything else is not drawable.
export function glyphFor(ch: string): number[] {
  return FONT.get(ch) ?? FONT.get(' ')!;
}

/** Truncates by code point, ending in an ellipsis when text is cut. */
export function fitText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, Math.max(0, maxChars - 1)).join('') + ELLIPSIS;
}

// ---- Anti-aliased vector font -----------------------------------------
// Glyphs are stroked polylines in font units (cap top y=0, x-height top y=2.5,
// baseline y=8, descenders to y=10). They are rasterised by supersampling:
// each pixel is split into SS x SS samples and the covered share becomes the
// alpha used to blend the text colour into the pixel underneath.

type Pt = [number, number];
type Stroke = Pt[];
type VGlyph = { adv: number; strokes: Stroke[] };

export const TEXT_SUPERSAMPLE = 8;
const FONT_SPACING = 1.5;
const SPACE_ADVANCE = 3;
const TEXT_MAX_SCALE = 2.0; // cap height 16 px
const TEXT_MIN_SCALE = 1.5; // cap height 12 px
const TEXT_SCALE_STEP = 0.01;
/** Horizontal squeeze of glyphs and advances (slightly condensed) to fit more characters. */
export const TEXT_X_SCALE = 0.85;

/** Points of an ellipse arc; angles in degrees, 0 = right, 90 = down. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Stroke {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 12));
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Quadratic Bezier from p0 to p2 with control point p1. */
function bez(p0: Pt, p1: Pt, p2: Pt): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return pts;
}

const oval = (cx: number, cy: number, rx: number, ry: number): Stroke => arc(cx, cy, rx, ry, 0, 360);

/** An S spanning height h from `top`, width 2*rx. */
function sCurve(rx: number, top: number, h: number): Stroke {
  const q = h / 4;
  return [...arc(rx, top + q, rx, q, 330, 90), ...arc(rx, top + 3 * q, rx, q, 270, 510)];
}

function vg(strokes: Stroke[], adv?: number): VGlyph {
  let maxX = 0;
  for (const st of strokes) for (const [x] of st) maxX = Math.max(maxX, x);
  return { adv: adv ?? maxX + FONT_SPACING, strokes };
}

const VFONT = new Map<string, VGlyph>([
  ['A', vg([[[0, 8], [2.6, 0], [5.2, 8]], [[1, 5.4], [4.2, 5.4]]])],
  ['B', vg([[[0, 8], [0, 0], [3, 0], ...arc(3, 2, 2, 2, -90, 90), [0, 4]], [[0, 4], [3.2, 4], ...arc(3.2, 6, 2, 2, -90, 90), [0, 8]]])],
  ['C', vg([arc(2.8, 4, 2.8, 4, 40, 320)])],
  ['D', vg([[[0, 0], [0, 8], [2, 8], ...arc(2, 4, 3.2, 4, 90, -90), [0, 0]]])],
  ['E', vg([[[5, 0], [0, 0], [0, 8], [5, 8]], [[0, 4], [4, 4]]])],
  ['F', vg([[[5, 0], [0, 0], [0, 8]], [[0, 4], [4, 4]]])],
  ['G', vg([[...arc(2.8, 4, 2.8, 4, 320, 40), [5.6, 4], [3, 4]]])],
  ['H', vg([[[0, 0], [0, 8]], [[5, 0], [5, 8]], [[0, 4], [5, 4]]])],
  ['I', vg([[[0.8, 0], [0.8, 8]]])],
  ['J', vg([[[3.5, 0], [3.5, 5.5], ...arc(1.75, 5.5, 1.75, 2.5, 0, 180)]])],
  ['K', vg([[[0, 0], [0, 8]], [[5, 0], [0, 5]], [[1.8, 3.4], [5, 8]]])],
  ['L', vg([[[0, 0], [0, 8], [4.5, 8]]])],
  ['M', vg([[[0, 8], [0, 0], [3.2, 6], [6.4, 0], [6.4, 8]]])],
  ['N', vg([[[0, 8], [0, 0], [5, 8], [5, 0]]])],
  ['O', vg([oval(2.8, 4, 2.8, 4)])],
  ['P', vg([[[0, 8], [0, 0], [2.8, 0], ...arc(2.8, 2.2, 2.2, 2.2, -90, 90), [0, 4.4]]])],
  ['Q', vg([oval(2.8, 4, 2.8, 4), [[3.2, 5.8], [5.6, 8.4]]])],
  ['R', vg([[[0, 8], [0, 0], [2.8, 0], ...arc(2.8, 2.2, 2.2, 2.2, -90, 90), [0, 4.4]], [[2.6, 4.4], [5.2, 8]]])],
  ['S', vg([sCurve(2.6, 0, 8)])],
  ['T', vg([[[0, 0], [5, 0]], [[2.5, 0], [2.5, 8]]])],
  ['U', vg([[[0, 0], [0, 5], ...arc(2.6, 5, 2.6, 3, 180, 0), [5.2, 0]]])],
  ['V', vg([[[0, 0], [2.7, 8], [5.4, 0]]])],
  ['W', vg([[[0, 0], [1.7, 8], [3.7, 2], [5.7, 8], [7.4, 0]]])],
  ['X', vg([[[0, 0], [5, 8]], [[5, 0], [0, 8]]])],
  ['Y', vg([[[0, 0], [2.6, 4.2], [5.2, 0]], [[2.6, 4.2], [2.6, 8]]])],
  ['Z', vg([[[0, 0], [5, 0], [0, 8], [5, 8]]])],
  ['a', vg([oval(2.2, 5.25, 2.2, 2.75), [[4.4, 2.5], [4.4, 8]]])],
  ['b', vg([[[0, 0], [0, 8]], oval(2.2, 5.25, 2.2, 2.75)])],
  ['c', vg([arc(2.2, 5.25, 2.2, 2.75, 40, 320)])],
  ['d', vg([oval(2.2, 5.25, 2.2, 2.75), [[4.4, 0], [4.4, 8]]])],
  ['e', vg([[[0, 5.25], [4.4, 5.25], ...arc(2.2, 5.25, 2.2, 2.75, 0, -320)]])],
  ['f', vg([[[1.2, 8], [1.2, 1.8], ...arc(2.6, 1.8, 1.4, 1.8, 180, 270), [3.4, 0]], [[0, 2.5], [3.2, 2.5]]])],
  ['g', vg([oval(2.2, 5.25, 2.2, 2.75), [[4.4, 2.5], [4.4, 8.4], ...arc(2.2, 8.4, 2.2, 1.6, 0, 150)]])],
  ['h', vg([[[0, 0], [0, 8]], [...arc(2.1, 4.6, 2.1, 2.1, 180, 360), [4.2, 8]]])],
  ['i', vg([[[0.8, 2.5], [0.8, 8]], [[0.8, 0.3], [0.8, 0.5]]])],
  ['j', vg([[[1.6, 2.5], [1.6, 8.6], ...arc(0.2, 8.6, 1.4, 1.4, 0, 100)], [[1.6, 0.3], [1.6, 0.5]]])],
  ['k', vg([[[0, 0], [0, 8]], [[3.8, 2.5], [0, 5.8]], [[1.4, 4.7], [4, 8]]])],
  ['l', vg([[[0.8, 0], [0.8, 8]]])],
  ['m', vg([[[0, 2.5], [0, 8]], [...arc(1.9, 4.4, 1.9, 1.9, 180, 360), [3.8, 8]], [...arc(5.7, 4.4, 1.9, 1.9, 180, 360), [7.6, 8]]])],
  ['n', vg([[[0, 2.5], [0, 8]], [...arc(2.1, 4.6, 2.1, 2.1, 180, 360), [4.2, 8]]])],
  ['o', vg([oval(2.3, 5.25, 2.3, 2.75)])],
  ['p', vg([[[0, 2.5], [0, 10]], oval(2.2, 5.25, 2.2, 2.75)])],
  ['q', vg([oval(2.2, 5.25, 2.2, 2.75), [[4.4, 2.5], [4.4, 10]]])],
  ['r', vg([[[0, 2.5], [0, 8]], arc(2.1, 4.6, 2.1, 2.1, 180, 290)])],
  ['s', vg([sCurve(2, 2.5, 5.5)])],
  ['t', vg([[[1.4, 0.8], [1.4, 6.6], ...arc(2.8, 6.6, 1.4, 1.4, 180, 60)], [[0, 2.5], [3.4, 2.5]]])],
  ['u', vg([[[0, 2.5], [0, 5.4], ...arc(2.1, 5.4, 2.1, 2.6, 180, 0)], [[4.2, 2.5], [4.2, 8]]])],
  ['v', vg([[[0, 2.5], [2.2, 8], [4.4, 2.5]]])],
  ['w', vg([[[0, 2.5], [1.5, 8], [3.2, 3.5], [4.9, 8], [6.4, 2.5]]])],
  ['x', vg([[[0, 2.5], [4.2, 8]], [[4.2, 2.5], [0, 8]]])],
  ['y', vg([[[0, 2.5], [2.2, 8]], [[4.4, 2.5], [1.2, 10]]])],
  ['z', vg([[[0, 2.5], [4, 2.5], [0, 8], [4, 8]]])],
  ['0', vg([oval(2.4, 4, 2.4, 4)])],
  ['1', vg([[[0.4, 1.8], [2.2, 0], [2.2, 8]]])],
  ['2', vg([[...arc(2.3, 2.4, 2.3, 2.4, 180, 390), [0, 8], [4.8, 8]]])],
  ['3', vg([[...arc(2.2, 2, 2.2, 2, 200, 450), ...arc(2.3, 6, 2.4, 2, 270, 520)]])],
  ['4', vg([[[3.8, 8], [3.8, 0], [0, 5.8], [5, 5.8]]])],
  ['5', vg([[[4.4, 0], [0.6, 0], [0.4, 3.6], ...arc(2.4, 5.6, 2.4, 2.4, 250, 500)]])],
  ['6', vg([oval(2.4, 5.4, 2.4, 2.6), bez([0, 5.4], [0, 0.2], [3.6, 0.1])])],
  ['7', vg([[[0, 0], [4.6, 0], [1.6, 8]]])],
  ['8', vg([oval(2.3, 2.1, 2, 2.1), oval(2.3, 6, 2.4, 2)])],
  ['9', vg([oval(2.4, 2.6, 2.4, 2.6), bez([4.8, 2.6], [4.8, 7.8], [1.2, 7.9])])],
  ['-', vg([[[0, 4.5], [3, 4.5]]])],
  ['_', vg([[[0, 9], [5, 9]]])],
  ['.', vg([[[0.6, 7.7], [0.6, 8]]])],
  ['/', vg([[[0, 8], [3.2, 0]]])],
  [' ', { adv: SPACE_ADVANCE, strokes: [] }],
  [ELLIPSIS, vg([[[0.6, 7.7], [0.6, 8]], [[3, 7.7], [3, 8]], [[5.4, 7.7], [5.4, 8]]])],
  ['?', vg([[...arc(2.2, 2.4, 2.2, 2.4, 180, 400), [2.2, 5.6]], [[2.2, 7.7], [2.2, 8]]])],
]);

/** Folds accents to base letters, strips control chars, maps unknown chars to '?'. */
export function normalizeBandText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const folded = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '');
  return Array.from(folded)
    .map((ch) => (VFONT.has(ch) ? ch : '?'))
    .join('')
    .trim();
}

function vglyph(ch: string): VGlyph {
  return VFONT.get(ch) ?? VFONT.get('?')!;
}

/** Width in pixels of text at the given scale (px per font unit), from real advances. */
export function measureText(text: string, scale: number): number {
  const chars = Array.from(text);
  if (!chars.length) return 0;
  let units = 0;
  for (const ch of chars) units += vglyph(ch).adv;
  return (units - FONT_SPACING) * scale * TEXT_X_SCALE;
}

/** Largest scale (down to a floor) where text fits, then ellipsis truncation. */
export function fitBandText(text: string, maxWidth: number): { text: string; scale: number } {
  const clean = normalizeBandText(text);
  for (let scale = TEXT_MAX_SCALE; scale >= TEXT_MIN_SCALE - 1e-9; scale -= TEXT_SCALE_STEP) {
    if (measureText(clean, scale) <= maxWidth) return { text: clean, scale };
  }
  const chars = Array.from(clean);
  let keep = chars.length - 1;
  while (keep > 0 && measureText(chars.slice(0, keep).join('').trimEnd() + ELLIPSIS, TEXT_MIN_SCALE) > maxWidth) keep--;
  return { text: chars.slice(0, keep).join('').trimEnd() + ELLIPSIS, scale: TEXT_MIN_SCALE };
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * Draws text anti-aliased, clipped to the rectangle (clipX, clipY, clipW, clipH).
 * `x` is the left edge, `capTop` the y of the cap line, in pixels.
 */
export function drawVectorText(
  canvas: Buffer,
  text: string,
  x: number,
  capTop: number,
  scale: number,
  rgb: Rgb,
  clip: { x: number; y: number; w: number; h: number },
  ss = TEXT_SUPERSAMPLE,
): void {
  const half = Math.max(1.2, 1.4 * scale) / 2;
  const sw = clip.w * ss;
  const sh = clip.h * ss;
  const cover = new Uint8Array(sw * sh);
  let cx = x;
  for (const ch of Array.from(text)) {
    const g = vglyph(ch);
    for (const stroke of g.strokes) {
      const pts = stroke.map(([u, v]): Pt => [cx + u * scale * TEXT_X_SCALE, capTop + v * scale]);
      for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
        const a = pts[i];
        const b = pts[Math.min(i + 1, pts.length - 1)];
        const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - half - clip.x) * ss));
        const x1 = Math.min(sw - 1, Math.ceil((Math.max(a[0], b[0]) + half - clip.x) * ss));
        const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - half - clip.y) * ss));
        const y1 = Math.min(sh - 1, Math.ceil((Math.max(a[1], b[1]) + half - clip.y) * ss));
        for (let sy = y0; sy <= y1; sy++) {
          for (let sx = x0; sx <= x1; sx++) {
            const px = clip.x + (sx + 0.5) / ss;
            const py = clip.y + (sy + 0.5) / ss;
            if (distToSegment(px, py, a, b) <= half) cover[sy * sw + sx] = 1;
          }
        }
      }
    }
    cx += g.adv * scale * TEXT_X_SCALE;
  }
  for (let j = 0; j < clip.h; j++) {
    for (let i = 0; i < clip.w; i++) {
      let n = 0;
      for (let v = 0; v < ss; v++) for (let u = 0; u < ss; u++) n += cover[(j * ss + v) * sw + i * ss + u];
      if (!n) continue;
      const alpha = n / (ss * ss);
      const o = ((clip.y + j) * FACE_SIZE + clip.x + i) * 4;
      for (let c = 0; c < 3; c++) canvas[o + c] = Math.round(canvas[o + c] * (1 - alpha) + rgb[c] * alpha);
    }
  }
}

type Canvas = Buffer;

function newCanvas(): Canvas {
  const canvas = Buffer.alloc(FACE_SIZE * FACE_SIZE * 4);
  fillRect(canvas, 0, 0, FACE_SIZE, FACE_SIZE, FACE_BG);
  return canvas;
}

function setPixel(canvas: Canvas, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= FACE_SIZE || y >= FACE_SIZE) return;
  const o = (y * FACE_SIZE + x) * 4;
  canvas[o] = rgb[0];
  canvas[o + 1] = rgb[1];
  canvas[o + 2] = rgb[2];
  canvas[o + 3] = 255;
}

function fillRect(canvas: Canvas, x: number, y: number, w: number, h: number, rgb: Rgb): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPixel(canvas, x + i, y + j, rgb);
}

function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: Rgb,
): void {
  let cx = x;
  for (const ch of Array.from(text)) {
    const rows = glyphFor(ch);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (rows[row] & (4 >> col)) {
          fillRect(canvas, cx + col * scale, y + row * scale, scale, scale, rgb);
        }
      }
    }
    cx += 4 * scale;
  }
}

export type FaceSpec = {
  tab?: number;
  /** 1-based position of the tab within its space; drawn as a small superscript. */
  tabNumber?: number | undefined;
  project?: string;
  session?: string;
  ring: { rgb: Rgb; style: CircleStyle };
  band?: Rgb;
};

/** Tab position text: 1..99 as is, anything larger shows `99`; non-positive or NaN draws nothing. */
export function superscriptText(tabNumber: number | undefined): string | undefined {
  if (tabNumber === undefined || !Number.isFinite(tabNumber) || tabNumber < 1) return undefined;
  return String(Math.min(99, Math.floor(tabNumber)));
}

type SupLayout = { mainScale: number; mainX: number; mainY: number; supX: number; supY: number };

const textWidth = (chars: number, scale: number) => (chars * 4 - 1) * scale;

/**
 * Main number plus a raised superscript at its upper right, the pair centred as a block and
 * kept inside the ring hole. The main number shrinks one step at a time until every corner of
 * both boxes lies within SUP_FIT_RADIUS of the ring centre.
 */
export function layoutWithSuperscript(mainChars: number, supChars: number): SupLayout {
  const supW = textWidth(supChars, SUP_SCALE);
  const supH = 5 * SUP_SCALE;
  let layout!: SupLayout;
  for (let mainScale = TAB_SCALES[mainChars] ?? 3; mainScale >= 2; mainScale--) {
    const mainW = textWidth(mainChars, mainScale);
    const mainH = 5 * mainScale;
    const blockW = mainW + SUP_GAP + supW;
    const mainX = Math.round(RING_CX - blockW / 2);
    const mainY = Math.round(RING_CY + SUP_DROP - mainH / 2);
    const supX = mainX + mainW + SUP_GAP;
    const supY = mainY - SUP_RAISE;
    layout = { mainScale, mainX, mainY, supX, supY };
    const corners: [number, number][] = [
      [mainX, mainY], [mainX + mainW, mainY], [mainX, mainY + mainH], [mainX + mainW, mainY + mainH],
      [supX, supY], [supX + supW, supY], [supX, supY + supH], [supX + supW, supY + supH],
    ];
    if (corners.every(([x, y]) => Math.hypot(x - RING_CX, y - RING_CY) <= SUP_FIT_RADIUS)) break;
  }
  return layout;
}

export function facePng(spec: FaceSpec): Buffer {
  const canvas = newCanvas();
  // Filled rings reach the stroke's outer edge so every style spans the same box.
  const fillR = RING_RADIUS + RING_STROKE / 2;
  for (let y = RING_CY - RING_OUTER; y <= RING_CY + RING_OUTER; y++) {
    for (let x = RING_CX - RING_OUTER; x <= RING_CX + RING_OUTER; x++) {
      const dx = x + 0.5 - RING_CX;
      const dy = y + 0.5 - RING_CY;
      const hit =
        spec.ring.style === 'filled'
          ? Math.hypot(dx, dy) <= fillR
          : ringHit(dx, dy, RING_RADIUS, RING_STROKE, spec.ring.style);
      if (hit) setPixel(canvas, x, y, spec.ring.rgb);
    }
  }
  if (spec.tab !== undefined) {
    const text = fitText(String(spec.tab), TAB_MAX_CHARS);
    const tabRgb = spec.ring.style === 'filled' ? FACE_BG : WHITE;
    const sup = superscriptText(spec.tabNumber);
    if (sup) {
      const layout = layoutWithSuperscript(text.length, sup.length);
      drawText(canvas, text, layout.mainX, layout.mainY, layout.mainScale, tabRgb);
      drawText(canvas, sup, layout.supX, layout.supY, SUP_SCALE, tabRgb);
    } else {
      const scale = TAB_SCALES[text.length] ?? 3;
      const width = (text.length * 4 - 1) * scale;
      drawText(canvas, text, Math.round(RING_CX - width / 2), Math.round(RING_CY - (5 * scale) / 2), scale, tabRgb);
    }
  }
  if (spec.project) {
    fillRect(canvas, 0, BAND_Y, FACE_SIZE, BAND_HEIGHT, spec.band ?? DEFAULT_BAND);
    const fit = fitBandText(spec.project, FACE_SIZE - 2 * BAND_PAD);
    const x = BAND_PAD + (FACE_SIZE - 2 * BAND_PAD - measureText(fit.text, fit.scale)) / 2;
    // Centre cap line plus descenders (10 font units) so g/p/y fit inside the band.
    const capTop = BAND_Y + (BAND_HEIGHT - 10 * fit.scale) / 2;
    drawVectorText(canvas, fit.text, x, capTop, fit.scale, WHITE, { x: 0, y: BAND_Y, w: FACE_SIZE, h: BAND_HEIGHT });
  }
  return encodePng(FACE_SIZE, FACE_SIZE, canvas);
}

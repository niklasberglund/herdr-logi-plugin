import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  circlePng,
  facePng,
  fitText,
  glyphFor,
  layoutWithSuperscript,
  superscriptText,
  fitBandText,
  measureText,
  normalizeBandText,
  BAND_HEIGHT,
  BAND_Y,
  RING_CX,
  RING_CY,
  type Rgb,
} from '../src/png.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunks(png: Buffer) {
  const out: { type: string; data: Buffer }[] = [];
  let offset = SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    assert.equal(crc, crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} chunk CRC`);
    out.push({ type, data });
    offset += 12 + length;
  }
  return out;
}

function pixels(png: Buffer, size: number) {
  const idat = chunks(png).find((c) => c.type === 'IDAT')!;
  const raw = inflateSync(idat.data);
  const stride = size * 4 + 1;
  assert.equal(raw.length, stride * size);
  return (x: number, y: number) => {
    assert.equal(raw[y * stride], 0, 'scanline filter byte');
    const o = y * stride + 1 + x * 4;
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
  };
}

test('encodes a well-formed RGBA PNG', () => {
  const size = 80;
  const png = circlePng(size, [1, 2, 3], 'filled');
  assert.deepEqual(png.subarray(0, 8), SIGNATURE);
  const [ihdr, idat, iend] = chunks(png);
  assert.equal(ihdr.type, 'IHDR');
  assert.equal(ihdr.data.readUInt32BE(0), size);
  assert.equal(ihdr.data.readUInt32BE(4), size);
  assert.equal(ihdr.data[8], 8, 'bit depth');
  assert.equal(ihdr.data[9], 6, 'RGBA colour type');
  assert.equal(idat.type, 'IDAT');
  assert.equal(iend.type, 'IEND');
});

test('filled circle covers the centre and leaves the corners transparent', () => {
  const at = pixels(circlePng(80, [230, 40, 40], 'filled'), 80);
  assert.deepEqual(at(40, 40), [230, 40, 40, 255]);
  assert.equal(at(0, 0)[3], 0);
  assert.equal(at(79, 79)[3], 0);
});

test('outline circle is hollow', () => {
  const at = pixels(circlePng(80, [0, 120, 48], 'outline'), 80);
  assert.equal(at(40, 40)[3], 0, 'centre is transparent');
  assert.equal(at(40, 12)[3], 255, 'ring is opaque at the top');
});

test('dotted circle has gaps along the ring', () => {
  const at = pixels(circlePng(80, [70, 70, 70], 'dotted'), 80);
  const ring: number[] = [];
  for (let i = 0; i < 360; i += 2) {
    const a = (i * Math.PI) / 180;
    ring.push(at(Math.round(40 + 28 * Math.cos(a)), Math.round(40 + 28 * Math.sin(a)))[3]);
  }
  assert.ok(ring.includes(255), 'some of the ring is drawn');
  assert.ok(ring.includes(0), 'some of the ring is a gap');
});

const GOLDEN: Record<'filled' | 'outline' | 'dotted', string> = {
  filled: '231768d624fa2e733f6088da7809785883be9ef81eae2dd39a35a3ca3342d3bd',
  outline: '0a1ad2456f1371adaffe0a9f4fad233d6b35ef45ccd588c14399c96db5aa398e',
  dotted: '7e95d2a24b44999f31dc86cff31a1fcd20fcbd3f2634b999df4ce59a212130d6',
};

test('circlePng output is byte-identical to the pre-face renderer', () => {
  for (const style of ['filled', 'outline', 'dotted'] as const) {
    const hash = createHash('sha256').update(circlePng(80, [0, 200, 80], style)).digest('hex');
    assert.equal(hash, GOLDEN[style], style);
  }
});

const GREEN: Rgb = [0, 200, 80];
const BAND = [0x3b, 0x82, 0xf6, 255];
const BG = [0, 0, 0, 255];

function isWhite(p: number[]): boolean {
  return p[0] === 255 && p[1] === 255 && p[2] === 255;
}

function isRing(p: number[]): boolean {
  return p[0] === GREEN[0] && p[1] === GREEN[1] && p[2] === GREEN[2];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function bounds(
  at: (x: number, y: number) => number[],
  match: (p: number[]) => boolean,
  yMax = BAND_Y,
): Box | undefined {
  let box: Box | undefined;
  for (let y = 0; y < yMax; y++) {
    for (let x = 0; x < 80; x++) {
      if (!match(at(x, y))) continue;
      box = box
        ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) }
        : { x0: x, y0: y, x1: x, y1: y };
    }
  }
  return box;
}

/** Bounds of the dark knock-out digits inside a filled ring, from the ring colour's holes. */
function digitBounds(at: (x: number, y: number) => number[]): Box | undefined {
  let box: Box | undefined;
  for (let y = 0; y < BAND_Y; y++) {
    for (let x = 0; x < 80; x++) {
      if (Math.hypot(x + 0.5 - RING_CX, y + 0.5 - RING_CY) >= 22 || at(x, y)[0] !== 0 || isRing(at(x, y))) continue;
      box = box
        ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) }
        : { x0: x, y0: y, x1: x, y1: y };
    }
  }
  return box;
}

const full = { tab: 3, project: 'herdr', session: 'fix-login', ring: { rgb: GREEN, style: 'filled' as const } };

test('facePng draws big tab, big ring and a plain band in an 80x80 PNG', () => {
  const png = facePng(full);
  const ihdr = chunks(png)[0];
  assert.equal(ihdr.data.readUInt32BE(0), 80);
  assert.equal(ihdr.data.readUInt32BE(4), 80);
  const at = pixels(png, 80);
  const ring = bounds(at, isRing)!;
  assert.ok(ring.x1 - ring.x0 + 1 >= 56, 'ring is at least 56 px wide');
  assert.ok(ring.y1 - ring.y0 + 1 >= 56, 'ring is at least 56 px tall');
  assert.ok(ring.y1 < BAND_Y, 'ring is above the band');
  const tab = digitBounds(at)!;
  assert.ok(tab, 'tab number is drawn');
  assert.ok(tab.y1 - tab.y0 + 1 >= 15, 'tab number is large');
});

test('band text is anti-aliased: white, band and intermediate blends, inside the band only', () => {
  const at = pixels(facePng(full), 80);
  let white = 0;
  let blended = 0;
  let plain = 0;
  for (let y = BAND_Y; y < BAND_Y + BAND_HEIGHT; y++) {
    for (let x = 0; x < 80; x++) {
      const p = at(x, y);
      assert.equal(p[3], 255);
      if (isWhite(p)) white++;
      else if (p[0] === BAND[0] && p[1] === BAND[1] && p[2] === BAND[2]) plain++;
      else {
        blended++;
        assert.ok(p[0] > BAND[0] && p[0] < 255, 'blend lies between band and white');
      }
    }
  }
  assert.ok(white > 0 && plain > 0, 'text and plain band both present');
  assert.ok(blended >= white / 2, 'edges carry intermediate colours');
  assert.deepEqual(at(40, BAND_Y - 1), BG.slice(0, 3).concat(255), 'band starts at BAND_Y');
  assert.deepEqual(at(0, BAND_Y), BAND, 'band corner stays plain');
});

test('band text differs per project name and an empty project draws no band', () => {
  const a = facePng({ ...full, project: 'alpha' });
  const b = facePng({ ...full, project: 'bravo' });
  assert.ok(!a.equals(b));
  assert.ok(!a.equals(facePng({ ...full, project: undefined as unknown as string })));
});

test('measureText uses real advances: wide letters measure wider than narrow ones', () => {
  assert.ok(measureText('WWWW', 1) > measureText('iiii', 1) * 2);
  assert.equal(measureText('', 1), 0);
  assert.ok(Math.abs(measureText('abc', 2) - 2 * measureText('abc', 1)) < 1e-9);
});

test('fitBandText shrinks first, then truncates with an ellipsis, always within the width', () => {
  const max = 74;
  const short = fitBandText('herdr', max);
  const mid = fitBandText('herdr-logi', max);
  const long = fitBandText('herdr-logi-plugin-with-a-very-long-name', max);
  assert.equal(short.text, 'herdr');
  assert.ok(short.scale > mid.scale, 'a longer name uses a smaller scale');
  assert.equal(mid.text, 'herdr-logi');
  assert.ok(mid.scale >= 1.5 - 1e-9 && short.scale <= 2 + 1e-9, 'cap height stays between 12 and 16 px');
  assert.ok(long.scale >= 1.5 - 1e-9, 'truncation happens at the 12 px cap floor');
  assert.ok(long.text.endsWith('\u2026') && long.text.length < 40);
  for (const f of [short, mid, long, fitBandText('W'.repeat(60), max)]) {
    assert.ok(measureText(f.text, f.scale) <= max, f.text);
  }
});

test('fitBandText handles an empty string safely', () => {
  const f = fitBandText('', 74);
  assert.equal(f.text, '');
  assert.ok(Number.isFinite(f.scale) && f.scale >= 1.5 - 1e-9);
  assert.equal(measureText(f.text, f.scale), 0);
});

test('normalizeBandText folds accents, strips controls and maps unknown chars to ?', () => {
  assert.equal(normalizeBandText('\u00c9cran \u00e9t\u00e9'), 'Ecran ete');
  assert.equal(normalizeBandText('a\nb\u0007c'), 'abc');
  assert.equal(normalizeBandText('a\u65e5b'), 'a?b');
  assert.equal(normalizeBandText('my_proj-1.2/x'), 'my_proj-1.2/x');
  assert.equal(normalizeBandText('constructor'), 'constructor');
});

test('every drawable character (A-Z a-z 0-9 - _ . / space) renders without throwing', () => {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 -_./';
  assert.doesNotThrow(() => facePng({ ...full, project: all }));
  assert.doesNotThrow(() => facePng({ ...full, project: '\u{1f600}'.repeat(30) }));
});

test('the band is flush to the bottom edge and the ring sits entirely above it', () => {
  assert.equal(BAND_Y + BAND_HEIGHT, 80);
  const at = pixels(facePng({ ...full, project: 'Gypsy jumpy_qg / long project name here' }), 80);
  assert.deepEqual(at(0, 79), BAND);
  assert.deepEqual(at(79, 79), BAND);
  assert.ok(bounds(at, isRing, 80)!.y1 < BAND_Y);
});

test('tab number sits inside the ring hole without touching the ring for 1, 2 and 3 digit tabs', () => {
  for (const tab of [1, 7, 12, 99, 123, 12345]) {
    for (const style of ['filled', 'outline', 'dotted'] as const) {
      const at = pixels(facePng({ tab, project: 'p', ring: { rgb: GREEN, style } }), 80);
      const t = style === 'filled' ? digitBounds(at)! : bounds(at, isWhite)!;
      assert.ok(t, `tab ${tab} ${style} is drawn`);
      for (const [x, y] of [[t.x0, t.y0], [t.x1, t.y0], [t.x0, t.y1], [t.x1, t.y1]]) {
        assert.ok(Math.hypot(x + 0.5 - RING_CX, y + 0.5 - RING_CY) < 21, `tab ${tab} ${style} corner ${x},${y}`);
      }
      assert.ok(t.y1 - t.y0 + 1 >= 15, `tab ${tab} ${style} is large`);
    }
  }
});

test('fitText truncates by code point with an ellipsis', () => {
  assert.equal(fitText('herdr-logi-plugin-fork', 9), 'herdr-lo\u2026');
  assert.equal(fitText('short', 9), 'short');
  assert.equal(fitText('', 9), '');
  assert.equal(Array.from(fitText('\u{1f600}'.repeat(20), 9)).length, 9);
});

test('glyphFor knows digits and the ellipsis, and blanks anything else', () => {
  for (const d of '0123456789') assert.notDeepEqual(glyphFor(d), glyphFor(' '), d);
  assert.notDeepEqual(glyphFor('\u2026'), glyphFor(' '));
  for (const ch of ['a', '\u00e9', '\u65e5', 'constructor']) assert.deepEqual(glyphFor(ch), glyphFor(' '), ch);
});

test('long session never draws text; long project is fitted into the band', () => {
  const long = facePng({
    tab: 12345,
    project: 'W'.repeat(40),
    session: 'M'.repeat(40),
    ring: { rgb: GREEN, style: 'outline' },
  });
  const sameProject = facePng({ tab: 12345, project: 'W'.repeat(40), session: '', ring: { rgb: GREEN, style: 'outline' } });
  assert.ok(long.equals(sameProject), 'session text does not reach the image');
  assert.doesNotThrow(() =>
    facePng({ tab: 1, project: '\u{1f600}'.repeat(30), session: '\u65e5'.repeat(30), ring: { rgb: GREEN, style: 'dotted' } }),
  );
});

function readAll(png: Buffer): number[][] {
  const at = pixels(png, 80);
  const out: number[][] = [];
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) out.push(at(x, y));
  return out;
}

test('empty face is tab number and dotted ring, no band', () => {
  const at = pixels(facePng({ tab: 7, ring: { rgb: GREEN, style: 'dotted' } }), 80);
  for (let y = BAND_Y; y < 80; y++) for (let x = 0; x < 80; x++) assert.deepEqual(at(x, y), BG, `${x},${y}`);
  assert.ok(bounds(at, isWhite), 'tab number is drawn');
  assert.ok(bounds(at, isRing), 'ring is drawn');
});

test('offline face has the ring but no tab number and no band', () => {
  const at = pixels(facePng({ ring: { rgb: GREEN, style: 'outline' } }), 80);
  assert.equal(bounds(at, isWhite), undefined);
  assert.equal(bounds(at, (p) => p[0] === BAND[0] && p[2] === BAND[2]), undefined);
  assert.ok(bounds(at, isRing));
});

test('ring styles keep their shape at the larger size', () => {
  const count = (style: 'filled' | 'outline' | 'dotted') => {
    const at = pixels(facePng({ tab: 1, ring: { rgb: GREEN, style } }), 80);
    let n = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (isRing(at(x, y))) n++;
    return { n, centre: isRing(at(RING_CX, RING_CY - 20)) };
  };
  const filled = count('filled');
  const outline = count('outline');
  const dotted = count('dotted');
  assert.ok(filled.centre && !outline.centre && !dotted.centre);
  assert.ok(filled.n > outline.n && outline.n > dotted.n && dotted.n > 0);
  const ring = bounds(pixels(facePng({ tab: 1, ring: { rgb: GREEN, style: 'outline' } }), 80), isRing)!;
  assert.ok(ring.x1 - ring.x0 + 1 >= 56);
});

test('facePng is deterministic', () => {
  const spec = { tab: 2, project: 'herdr', session: 'x', ring: { rgb: GREEN, style: 'filled' as const } };
  assert.deepEqual(readAll(facePng(spec)), readAll(facePng(spec)));
  assert.ok(facePng(spec).equals(facePng(spec)));
});

test('band text caps are at least 12 px tall, even for long names', () => {
  for (const project of ['api', 'herdr-logi', 'my-long-project-name']) {
    const at = pixels(facePng({ tab: 1, project, ring: { rgb: GREEN, style: 'filled' } }), 80);
    let y0 = 80;
    let y1 = -1;
    for (let y = BAND_Y; y < BAND_Y + BAND_HEIGHT; y++) {
      for (let x = 0; x < 80; x++) {
        const p = at(x, y);
        if (p[0] > 200 && p[1] > 200) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    assert.ok(y1 - y0 + 1 >= 12, `${project}: text spans ${y1 - y0 + 1}px`);
  }
});

const lit = (png: Buffer, filled: boolean, x0: number, y0: number, x1: number, y1: number) => {
  const at = pixels(png, 80);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = at(x, y);
    if (filled ? p[0] === 0 && p[1] === 0 && p[2] === 0 : p[0] === 255 && p[1] === 255 && p[2] === 255) n++;
  }
  return n;
};

test('superscriptText caps at 99 and hides unknown positions', () => {
  assert.equal(superscriptText(undefined), undefined);
  assert.equal(superscriptText(0), undefined);
  assert.equal(superscriptText(NaN), undefined);
  assert.equal(superscriptText(2), '2');
  assert.equal(superscriptText(99), '99');
  assert.equal(superscriptText(150), '99');
});

test('the tab superscript is drawn only when a tab number is given, and changes the face', () => {
  const ring = { rgb: GREEN, style: 'outline' } as const;
  const plain = facePng({ tab: 3, project: 'p', ring });
  const sup = facePng({ tab: 3, tabNumber: 2, project: 'p', ring });
  assert.ok(!plain.equals(sup));
  assert.ok(plain.equals(facePng({ tab: 3, tabNumber: undefined, project: 'p', ring })));
  assert.ok(!sup.equals(facePng({ tab: 3, tabNumber: 5, project: 'p', ring })));
  // The superscript box holds white ink.
  const L = layoutWithSuperscript(1, 1);
  assert.ok(lit(sup, false, L.supX, L.supY, L.supX + 7, L.supY + 10) > 5);
});

test('superscript sits at the upper right of the main number, inside the ring hole, without overlap', () => {
  for (let mainChars = 1; mainChars <= 3; mainChars++) {
    for (let supChars = 1; supChars <= 2; supChars++) {
      const L = layoutWithSuperscript(mainChars, supChars);
      const mainW = (mainChars * 4 - 1) * L.mainScale;
      const mainH = 5 * L.mainScale;
      const supW = (supChars * 4 - 1) * 2;
      assert.ok(L.supX >= L.mainX + mainW + 1, `${mainChars}/${supChars} right of main`);
      assert.ok(L.supY < L.mainY, `${mainChars}/${supChars} raised above main top`);
      assert.ok(L.supY + 10 <= L.mainY + mainH, `${mainChars}/${supChars} not below main`);
      for (const [x, y] of [[L.mainX, L.mainY], [L.mainX, L.mainY + mainH], [L.supX + supW, L.supY], [L.supX + supW, L.supY + 10]]) {
        assert.ok(Math.hypot(x - RING_CX, y - RING_CY) <= 21.5, `${mainChars}/${supChars} corner ${x},${y}`);
      }
    }
  }
});

test('superscript renders inside the hole for every style, space width and tab 1..99', () => {
  for (const style of ['filled', 'outline', 'dotted'] as const) {
    for (const tab of [3, 12, 123]) {
      for (const tabNumber of [1, 2, 11, 99, 500]) {
        const png = facePng({ tab, tabNumber, project: 'p', ring: { rgb: GREEN, style } });
        const at = pixels(png, 80);
        const ink = style === 'filled' ? digitBounds(at) : bounds(at, isWhite);
        assert.ok(ink, `${style} ${tab}^${tabNumber}`);
        for (const [x, y] of [[ink.x0, ink.y0], [ink.x1, ink.y0], [ink.x0, ink.y1], [ink.x1, ink.y1]]) {
          assert.ok(Math.hypot(x + 0.5 - RING_CX, y + 0.5 - RING_CY) < 22, `${style} ${tab}^${tabNumber} corner ${x},${y}`);
        }
      }
    }
  }
});

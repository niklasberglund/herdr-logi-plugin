// Renders package/metadata/Icon256x256.png: a 3x3 grid of status rings in the
// same visual language as the live tiles. Logitech requires a 256x256 PNG whose
// graphic fits inside a centred 192x192 area with transparent padding, and it
// must read on both black and white backgrounds.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const PITCH = 64;
const RADIUS = 21;
const STROKE = 7;
const DOTS = 10;
const SUPERSAMPLE = 4;

const colours = {
  blocked: [230, 40, 40],
  working: [240, 180, 0],
  done: [0, 200, 80],
  idle: [0, 150, 60],
  none: [128, 128, 128],
};

// Row by row, top to bottom.
const grid = [
  ['idle', 'outline'], ['working', 'filled'], ['idle', 'outline'],
  ['blocked', 'filled'], ['done', 'filled'], ['none', 'dotted'],
  ['idle', 'outline'], ['none', 'dotted'], ['working', 'filled'],
];

const circles = grid.map(([colour, style], i) => ({
  cx: SIZE / 2 + ((i % 3) - 1) * PITCH,
  cy: SIZE / 2 + (Math.floor(i / 3) - 1) * PITCH,
  rgb: colours[colour],
  style,
}));

function inside({ cx, cy, style }, x, y) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (style === 'filled') return d <= RADIUS;
  const onRing = Math.abs(d - RADIUS) <= STROKE / 2;
  if (style === 'outline') return onRing;
  const phase = ((Math.atan2(dy, dx) / (2 * Math.PI)) * DOTS + DOTS) % 1;
  return onRing && phase < 0.5;
}

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(stride * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let hits = 0;
    let rgb = [0, 0, 0];
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const px = x + (sx + 0.5) / SUPERSAMPLE;
        const py = y + (sy + 0.5) / SUPERSAMPLE;
        const circle = circles.find((c) => inside(c, px, py));
        if (circle) {
          hits++;
          rgb = circle.rgb;
        }
      }
    }
    const o = y * stride + 1 + x * 4;
    raw[o] = rgb[0];
    raw[o + 1] = rgb[1];
    raw[o + 2] = rgb[2];
    raw[o + 3] = Math.round((255 * hits) / (SUPERSAMPLE * SUPERSAMPLE));
  }
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = 'package/metadata/Icon256x256.png';
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);

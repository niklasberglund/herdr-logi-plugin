import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { circlePng } from '../src/png.ts';

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

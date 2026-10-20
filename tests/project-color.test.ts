import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PROJECT_COLOR, PROJECT_PALETTE, projectColor } from '../src/project-color.ts';
import { facePng } from '../src/png.ts';
import { faceFor } from '../src/status-bridge.ts';
import { AgentAction } from '../src/actions.ts';

test('projectColor is stable for one name', () => {
  assert.deepEqual(projectColor('api'), projectColor('api'));
});

test('projectColor returns a palette member', () => {
  for (const name of ['api', 'web', 'données', '日本語', 'a'.repeat(5000)]) {
    assert.ok(PROJECT_PALETTE.some((c) => c.join() === projectColor(name).join()));
  }
});

test('empty or blank name keeps the default blue', () => {
  assert.deepEqual(projectColor(''), DEFAULT_PROJECT_COLOR);
  assert.deepEqual(projectColor('   '), DEFAULT_PROJECT_COLOR);
  assert.deepEqual(DEFAULT_PROJECT_COLOR, [0x3b, 0x82, 0xf6]);
});

test('faceFor paints the project band with projectColor', () => {
  const action = new AgentAction(0);
  action.status = 'idle';
  action.face = { tab: 1, project: 'api', session: 's' };
  const expected = facePng({
    tab: 1,
    project: 'api',
    session: 's',
    ring: { rgb: [0, 120, 48], style: 'outline' },
    band: projectColor('api'),
  }).toString('base64');
  assert.equal(faceFor(action), expected);
});

function hue([r, g, b]: readonly number[]): number {
  const [R, G, B] = [r! / 255, g! / 255, b! / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (d === 0) return 0;
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrastWithWhite = (rgb: readonly number[]) => 1.05 / (luminance(rgb) + 0.05);

test('no palette color reads as the red, yellow or green state ring', () => {
  // Orange (15-45 degrees, #e07b39 at ~21) is the design-chosen exception in palette.json.
  for (const color of PROJECT_PALETTE) {
    const h = hue(color);
    assert.ok(!(h >= 345 || h < 15), `red hue ${h} for ${color}`);
    assert.ok(!(h >= 45 && h <= 70), `yellow hue ${h} for ${color}`);
    assert.ok(!(h >= 75 && h <= 165), `green hue ${h} for ${color}`);
  }
});

test('white band text has contrast of at least 3.0 on every palette color', () => {
  for (const color of PROJECT_PALETTE) {
    assert.ok(contrastWithWhite(color) >= 3.0, `${color} contrast ${contrastWithWhite(color).toFixed(2)}`);
  }
});

test('200 sample names reach every palette entry; case and whitespace do not matter', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(projectColor(`project-${i}`).join());
  assert.equal(seen.size, PROJECT_PALETTE.length);
  assert.deepEqual(projectColor('  API '), projectColor('api'));
});

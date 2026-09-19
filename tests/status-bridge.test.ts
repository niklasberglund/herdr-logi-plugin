import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TileStatus } from '../src/actions.ts';
import { imageFor } from '../src/status-bridge.ts';

const STATUSES: TileStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown', 'none', 'offline'];

test('every known status renders its own image', () => {
  const images = STATUSES.map(imageFor);
  assert.equal(new Set(images).size, STATUSES.length);
  for (const image of images) assert.ok(image.length > 0);
});

test('a status this plugin does not know renders as unknown and is reported once', () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => void warnings.push(message);
  try {
    const future = 'compacting' as TileStatus;
    assert.equal(imageFor(future), imageFor('unknown'));
    assert.equal(imageFor(future), imageFor('unknown'));
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /'compacting'/);
});

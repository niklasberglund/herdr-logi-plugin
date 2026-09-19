import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SlotAction, TileStatus } from '../src/actions.ts';
import { EMPTY_SNAPSHOT } from '../src/herdr.ts';
import { applySnapshot, hookMessages, imageFor } from '../src/status-bridge.ts';

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

type FakeAction = { name: string; status: TileStatus; label: string; update: () => void };

function fakeActions(...actions: Partial<FakeAction>[]): SlotAction[] {
  const built = actions.map((action, i) => ({
    name: `herdr_space_${i + 1}`,
    status: 'none' as TileStatus,
    label: '',
    update: () => {},
    ...action,
  }));
  return built as unknown as SlotAction[];
}

// A stand-in for the SDK's private WebSocket client, so the bridge can be
// driven without a Plugin Service. `deliver` plays the part of the socket
// handing an incoming frame to whatever handler the bridge registered.
function fakeInternals() {
  const sent: Record<string, unknown>[] = [];
  const handled: string[] = [];
  let handler: ((data: Buffer) => void) | undefined;
  const internals = {
    _client: {
      onMessage(h: (data: Buffer) => void) {
        handler = h;
      },
      sendMessage(message: Record<string, unknown>) {
        sent.push(message);
      },
    },
    _handleMessage(data: Buffer) {
      handled.push(data.toString('utf8'));
      return Promise.resolve();
    },
  };
  return {
    internals: internals as unknown as Parameters<typeof hookMessages>[0],
    sent,
    handled,
    deliver(message: unknown) {
      const frame = typeof message === 'string' ? message : JSON.stringify(message);
      assert.ok(handler, 'the bridge registered no message handler');
      handler(Buffer.from(frame, 'utf8'));
    },
  };
}

const request = (name: string, actionName: string, id = 7) => ({
  id,
  name,
  messageType: 'Request',
  parameters: { actionName },
});

test('a GetActionImage request is answered with the action image', () => {
  const { internals, sent, handled, deliver } = fakeInternals();
  hookMessages(internals, fakeActions({ name: 'tile_a', status: 'working' }));

  deliver(request('GetActionImage', 'tile_a'));

  assert.equal(handled.length, 0);
  assert.deepEqual(sent, [
    {
      id: 7,
      name: 'GetActionImage',
      messageType: 'Response',
      data: { image: imageFor('working') },
      failed: false,
      errorMessage: '',
      errorCode: 0,
    },
  ]);
});

test('a GetActionText request is answered with the action label', () => {
  const { internals, sent, deliver } = fakeInternals();
  hookMessages(internals, fakeActions({ name: 'tile_b', label: 'build' }));

  deliver(request('GetActionText', 'tile_b'));

  assert.deepEqual(sent[0]?.data, { text: 'build' });
});

test('messages this bridge does not answer are left to the SDK', () => {
  const { internals, sent, handled, deliver } = fakeInternals();
  hookMessages(internals, fakeActions({ name: 'tile_c' }));

  deliver(request('GetActionImage', 'someone_elses_action'));
  deliver({ id: 1, name: 'GetActionImage', messageType: 'Event', parameters: { actionName: 'tile_c' } });
  deliver(request('KeyDown', 'tile_c'));
  deliver('not json at all');

  assert.equal(sent.length, 0);
  assert.equal(handled.length, 4);
});

test('a tile change is announced as an event naming the plugin', () => {
  const previous = process.env.LPS_PLUGIN_NAME;
  process.env.LPS_PLUGIN_NAME = 'Herdr';
  try {
    const { internals, sent } = fakeInternals();
    const notify = hookMessages(internals, fakeActions({ name: 'tile_d' }));

    notify('ActionImageChanged', 'tile_d');

    assert.deepEqual(sent, [
      {
        id: 0,
        name: 'ActionImageChanged',
        messageType: 'Event',
        parameters: { pluginName: 'Herdr', actionName: 'tile_d', actionParameter: null },
      },
    ]);
  } finally {
    if (previous === undefined) delete process.env.LPS_PLUGIN_NAME;
    else process.env.LPS_PLUGIN_NAME = previous;
  }
});

test('changed SDK internals disable live images without breaking the plugin', () => {
  const error = console.error;
  const errors: string[] = [];
  console.error = (message: string) => void errors.push(message);
  try {
    // The SDK renamed, removed or reshaped the members the bridge hooks into.
    for (const internals of [{}, { _client: {} }, { _client: { onMessage: 1 }, _handleMessage: 2 }]) {
      const notify = hookMessages(internals as Parameters<typeof hookMessages>[0], fakeActions({}));
      assert.doesNotThrow(() => notify('ActionImageChanged', 'herdr_space_1'));
    }
  } finally {
    console.error = error;
  }
  assert.equal(errors.length, 3);
  assert.match(errors[0], /live tile images are disabled/);
});

test('a tile that cannot be updated is reported once and does not stop the others', () => {
  const error = console.error;
  const errors: string[] = [];
  console.error = (message: string) => void errors.push(message);
  const seen: string[] = [];
  const actions = fakeActions(
    {
      name: 'tile_broken',
      update: () => {
        throw new Error('snapshot shape changed');
      },
    },
    {
      name: 'tile_after',
      update() {
        (this as FakeAction).status = 'done';
      },
    },
  );
  try {
    applySnapshot(actions, EMPTY_SNAPSHOT, (_, name) => void seen.push(name));
    applySnapshot(actions, EMPTY_SNAPSHOT, (_, name) => void seen.push(name));
  } finally {
    console.error = error;
  }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /tile_broken/);
  // The slot after the broken one still updated, and only announced the change.
  assert.deepEqual(seen, ['tile_after']);
  assert.equal(actions[1]?.status, 'done');
});

test('no snapshot shows every tile as offline', () => {
  const seen: string[] = [];
  const actions = fakeActions({ name: 'tile_e', status: 'working' }, { name: 'tile_f', status: 'idle' });

  applySnapshot(actions, undefined, (_, name) => void seen.push(name));

  assert.deepEqual(
    actions.map((a) => a.status),
    ['offline', 'offline'],
  );
  assert.deepEqual(seen, ['tile_e', 'tile_f']);
});

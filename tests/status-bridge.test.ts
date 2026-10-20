import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentAction, RecentAgentAction, SpaceAction, type Face, type SlotAction, type TileStatus } from '../src/actions.ts';
import { EMPTY_SNAPSHOT, type Agent, type Snapshot } from '../src/herdr.ts';
import { BAND_Y, facePng } from '../src/png.ts';
import { DEFAULT_PROJECT_COLOR, projectColor } from '../src/project-color.ts';
import { inflateSync } from 'node:zlib';
import {
  applySnapshot,
  faceFor,
  hookMessages,
  imageFor,
  serviceText,
  SESSION_TEXT_MAX_CHARS,
  styleFor,
} from '../src/status-bridge.ts';

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

type FakeAction = { name: string; status: TileStatus; label: string; face: Face; update: () => void };

function fakeActions(...actions: Partial<FakeAction>[]): SlotAction[] {
  const built = actions.map((action, i) =>
    Object.assign(
      {
        name: `herdr_space_${i + 1}`,
        status: 'none' as TileStatus,
        label: '',
        face: { project: '', session: '' } as Face,
        update: () => {},
        get faceKey() {
          return JSON.stringify([this.status, this.face.tab ?? null, this.face.project, this.face.session]);
        },
      },
      action,
    ),
  );
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

test('a GetActionImage request is answered with the action face', () => {
  const { internals, sent, handled, deliver } = fakeInternals();
  const actions = fakeActions({ name: 'tile_a', status: 'working' });
  hookMessages(internals, actions);

  deliver(request('GetActionImage', 'tile_a'));

  assert.equal(handled.length, 0);
  assert.deepEqual(sent, [
    {
      id: 7,
      name: 'GetActionImage',
      messageType: 'Response',
      data: { image: faceFor(actions[0]!) },
      failed: false,
      errorMessage: '',
      errorCode: 0,
    },
  ]);
});

test('a GetActionText request is answered with the session only (project is in the image)', () => {
  const { internals, sent, deliver } = fakeInternals();
  hookMessages(
    internals,
    fakeActions({ name: 'tile_b', label: 'build', face: { tab: 3, project: 'herdr', session: 'fix-login' } }),
  );

  deliver(request('GetActionText', 'tile_b'));

  assert.deepEqual(sent[0]?.data, { text: 'fix-login' });
});

test('a New-tab key answers + tab only', () => {
  const { internals, sent, deliver } = fakeInternals();
  hookMessages(
    internals,
    fakeActions({ name: 'herdr_new_1', face: { tab: 1, project: 'my-project', session: '+ tab' } }),
  );

  deliver(request('GetActionText', 'herdr_new_1'));

  assert.deepEqual(sent[0]?.data, { text: '+ tab' });
});

test('an empty key answers the zero-width space', () => {
  const { internals, sent, deliver } = fakeInternals();
  hookMessages(internals, fakeActions({ name: 'tile_empty', face: { tab: 2, project: '', session: '' } }));

  deliver(request('GetActionText', 'tile_empty'));

  assert.deepEqual(sent[0]?.data, { text: '\u200b' });
});

test('serviceText is the session only, truncated to its maximum', () => {
  const text = serviceText({ project: 'p'.repeat(40), session: 's'.repeat(40) });
  assert.equal(Array.from(text).length, SESSION_TEXT_MAX_CHARS);
  assert.ok(text.endsWith('\u2026') && !text.includes('p'));
  assert.equal(serviceText({ project: 'web', session: 'only' }), 'only');
  assert.equal(serviceText({ project: 'web', session: '' }), '\u200b');
  assert.equal(serviceText({ project: '', session: '' }), '\u200b');
});

test('serviceText cannot be given extra lines by control characters in a title', () => {
  const text = serviceText({ project: 'web', session: 'a\nb\r\nc' });
  assert.ok(!text.includes('\n'));
  assert.ok(!/[\r\u0085\u2028]/.test(text));
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

  applySnapshot(actions, undefined, (event, name) => void seen.push(`${event} ${name}`));

  assert.deepEqual(
    actions.map((a) => [a.status, a.label]),
    [
      ['offline', 'offline'],
      ['offline', 'offline'],
    ],
  );
  assert.deepEqual(seen, [
    'ActionImageChanged tile_e',
    'ActionTextChanged tile_e',
    'ActionImageChanged tile_f',
    'ActionTextChanged tile_f',
  ]);
});

// --- key faces ---------------------------------------------------------------

const agentsFx: Agent[] = [
  { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Fix login' },
  { pane_id: 'w1:p2', workspace_id: 'w1', agent: 'codex', agent_status: 'idle', terminal_title_stripped: 'Write docs' },
  { pane_id: 'w2:p1', workspace_id: 'w2', agent: 'codex', agent_status: 'blocked', terminal_title_stripped: 'Other' },
];

function snapshotFx(recent: Agent[] = [agentsFx[1]!, agentsFx[0]!, agentsFx[2]!]): Snapshot {
  return {
    focusedWorkspaceId: 'w1',
    workspaces: new Map([[1, { workspace_id: 'w1', active_tab_id: 't', number: 1, label: 'web', agent_status: 'working' }]]),
    agents: agentsFx,
    recent,
    layouts: new Map(),
    tabs: new Map(),
  };
}

function faceRequest(action: SlotAction): string {
  const { internals, sent, deliver } = fakeInternals();
  hookMessages(internals, [action]);
  deliver(request('GetActionImage', action.name));
  return (sent[0]?.data as { image: string }).image;
}

function decode(base64: string) {
  const png = Buffer.from(base64, 'base64');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test('a Space key answers an 80x80 face that differs from the bare ring', () => {
  const space = new SpaceAction(1);
  space.update(snapshotFx());
  const image = faceRequest(space);
  assert.deepEqual(decode(image), { width: 80, height: 80 });
  assert.notEqual(image, imageFor(space.status));
  assert.deepEqual(space.face, { tab: 1, project: 'web', session: 'Write docs' });
});

test('empty Space, Agent and Recent slots show their slot number with a dotted ring and no band', () => {
  const blank = new SpaceAction(4);
  for (const action of [blank, new AgentAction(5), new RecentAgentAction(6)]) {
    action.update(snapshotFx([]));
    assert.equal(action.status, 'none');
    assert.deepEqual(action.face, { tab: action.slot, project: '', session: '' });
    const image = faceRequest(action);
    assert.deepEqual(decode(image), { width: 80, height: 80 });
    // Identical to a face with only the tab number and the dotted ring: no band, no text.
    assert.equal(image, facePng({ tab: action.slot, ring: styleFor('none') }).toString('base64'));
  }
  const agent = new AgentAction(5);
  agent.update(snapshotFx());
  assert.equal(agent.face.tab, 5);
});

test('Agent and Recent keys show their workspace number and label with their own title', () => {
  const agent = new AgentAction(3);
  const recent = new RecentAgentAction(1);
  const orphan = new AgentAction(1);
  const snap = snapshotFx();
  agent.update(snap);
  recent.update(snap);
  assert.deepEqual(agent.face, { tab: undefined, project: '', session: 'Other' });
  assert.deepEqual(recent.face, { tab: 1, project: 'web', session: 'Write docs' });
  orphan.update({ ...snap, workspaces: new Map() });
  assert.deepEqual(orphan.face, { tab: undefined, project: '', session: 'Fix login' });
});

test('a session-only change is announced as both image and text change', () => {
  const space = new SpaceAction(1);
  const seen: string[] = [];
  applySnapshot([space], snapshotFx(), (event) => void seen.push(event));
  seen.length = 0;
  const next = snapshotFx();
  next.agents = [{ ...agentsFx[0]!, terminal_title_stripped: 'New title' }, agentsFx[2]!];
  next.recent = next.agents;
  applySnapshot([space], next, (event) => void seen.push(event));
  assert.deepEqual(seen, ['ActionImageChanged', 'ActionTextChanged']);
});

test('nothing is announced when neither face nor text changes', () => {
  const space = new SpaceAction(1);
  const seen: string[] = [];
  applySnapshot([space], snapshotFx(), () => {});
  applySnapshot([space], snapshotFx(), (event) => void seen.push(event));
  assert.deepEqual(seen, []);
});

test('only a text change (label unchanged) sends ActionTextChanged', () => {
  const seen: string[] = [];
  const actions = fakeActions({
    name: 'tile_t',
    label: 'same',
    face: { tab: 1, project: 'web', session: 'one' },
    update() {
      (this as FakeAction).face = { tab: 1, project: 'web', session: 'one' };
      if (seen.length === 0) (this as FakeAction).face = { tab: 1, project: 'web', session: 'two' };
    },
  });
  applySnapshot(actions, EMPTY_SNAPSHOT, (event) => void seen.push(event));
  assert.ok(seen.includes('ActionTextChanged'));
});

test('the face cache stays bounded', () => {
  const space = new SpaceAction(1);
  for (let i = 0; i < 600; i++) {
    space.face = { tab: 1, project: `p${i}`, session: '' };
    assert.ok(faceFor(space).length > 0);
  }
});

test('a tile whose face building throws does not stop the others', () => {
  const error = console.error;
  console.error = () => {};
  const space = new SpaceAction(1);
  const other = new SpaceAction(2);
  const throwing = new SpaceAction(3);
  throwing.update = () => {
    throw new Error('face broke');
  };
  try {
    applySnapshot([throwing, space, other], snapshotFx(), () => {});
  } finally {
    console.error = error;
  }
  assert.equal(space.face.project, 'web');
});

// Band pixel at the band's left edge, where the project text never reaches.
function bandPixel(base64: string): [number, number, number] {
  const png = Buffer.from(base64, 'base64');
  let idat = Buffer.alloc(0);
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.subarray(offset + 4, offset + 8).toString('ascii') === 'IDAT') {
      idat = Buffer.concat([idat, png.subarray(offset + 8, offset + 8 + length)]);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(idat);
  const o = (BAND_Y + 1) * (png.readUInt32BE(16) * 4 + 1) + 1;
  return [raw[o]!, raw[o + 1]!, raw[o + 2]!];
}

function faceWith(status: TileStatus, face: Face): string {
  const space = new SpaceAction(1);
  space.status = status;
  space.face = face;
  return faceFor(space);
}

test('band color follows the project, not the status or session', () => {
  const a = bandPixel(faceWith('idle', { tab: 1, project: 'api', session: 'one' }));
  const b = bandPixel(faceWith('blocked', { tab: 2, project: 'api', session: 'two' }));
  assert.deepEqual(a, projectColor('api'));
  assert.deepEqual(a, b);
});

test('different projects get different band colors', () => {
  const names = ['api', 'web', 'docs', 'infra', 'mobile'];
  const colors = new Set(names.map((n) => bandPixel(faceWith('idle', { tab: 1, project: n, session: '' })).join()));
  assert.ok(colors.size > 1);
  for (const n of names) {
    assert.deepEqual(bandPixel(faceWith('idle', { tab: 1, project: n, session: '' })), projectColor(n));
  }
});

test('an empty project keeps the default blue and draws no band', () => {
  assert.deepEqual(projectColor(''), DEFAULT_PROJECT_COLOR);
  const image = faceWith('none', { tab: 1, project: '', session: '' });
  assert.equal(image, facePng({ tab: 1, ring: styleFor('none') }).toString('base64'));
});

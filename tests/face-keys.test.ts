import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  AgentAction,
  NewTabAction,
  RecentAgentAction,
  SpaceAction,
  type SlotAction,
  type TileStatus,
} from '../src/actions.ts';
import { EMPTY_SNAPSHOT, type Agent, type Snapshot } from '../src/herdr.ts';
import { PROJECT_PALETTE } from '../src/project-color.ts';
import { BAND_HEIGHT, BAND_Y, RING_CX, RING_CY } from '../src/png.ts';
import { applySnapshot, faceFor, hookMessages, styleFor } from '../src/status-bridge.ts';

type Pixel = [number, number, number, number];

function decode(base64: string) {
  const png = Buffer.from(base64, 'base64');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat = Buffer.concat([idat, png.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  const raw = inflateSync(idat);
  const stride = width * 4 + 1;
  const at = (x: number, y: number): Pixel => {
    const o = y * stride + 1 + x * 4;
    return [raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!];
  };
  return { width, height, at };
}

const isWhite = (p: Pixel) => p[0] === 255 && p[1] === 255 && p[2] === 255;
const isBlack = (p: Pixel) => p[0] === 0 && p[1] === 0 && p[2] === 0;
// The band takes its project's palette color, so any palette color counts as band.
const isBand = (p: Pixel) => PROJECT_PALETTE.some((c) => c[0] === p[0] && c[1] === p[1] && c[2] === p[2]);

// Probe inside the ring hole above the tab number: ring colour when filled, black otherwise.
const PROBE_Y = RING_CY - 20;
const inHole = (x: number, y: number) => Math.hypot(x + 0.5 - RING_CX, y + 0.5 - RING_CY) < 23;

/** Whether the tab number is drawn in the ring hole (white, or knocked out of a filled ring). */
function hasNumber(image: string): boolean {
  const { at } = decode(image);
  const filled = !isBlack(at(RING_CX, PROBE_Y));
  for (let y = 0; y < BAND_Y; y++) {
    for (let x = 0; x < 80; x++) {
      if (!inHole(x, y)) continue;
      const p = at(x, y);
      if (filled ? isBlack(p) : isWhite(p)) return true;
    }
  }
  return false;
}

function count(image: string, x0: number, y0: number, x1: number, y1: number, test: (p: Pixel) => boolean) {
  const { at } = decode(image);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (test(at(x, y))) n++;
  return n;
}

function fakeBridge(action: SlotAction[]) {
  const sent: Record<string, unknown>[] = [];
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
    _handleMessage: () => Promise.resolve(),
  };
  hookMessages(internals as unknown as Parameters<typeof hookMessages>[0], action);
  return {
    sent,
    ask(name: string, actionName: string) {
      handler!(Buffer.from(JSON.stringify({ id: 1, name, messageType: 'Request', parameters: { actionName } })));
      return sent[sent.length - 1]!.data as { image?: string; text?: string };
    },
  };
}

const agentFx = (title: string, id = 'w1:p1'): Agent => ({
  pane_id: id,
  workspace_id: 'w1',
  agent: 'claude',
  agent_status: 'working',
  terminal_title_stripped: title,
});

function snap(label = 'web', agents: Agent[] = [agentFx('Fix login')]): Snapshot {
  return {
    focusedWorkspaceId: 'w1',
    workspaces: new Map([[1, { workspace_id: 'w1', active_tab_id: 't', number: 1, label, agent_status: 'working' }]]),
    agents,
    recent: agents,
    layouts: new Map(),
    tabs: new Map(),
  };
}

test('a New-tab key answers an 80x80 face image and + tab service text', () => {
  const action = new NewTabAction(1);
  action.update(snap());
  const bridge = fakeBridge([action]);
  const image = bridge.ask('GetActionImage', action.name).image!;
  const { width, height } = decode(image);
  assert.deepEqual([width, height], [80, 80]);
  assert.equal(image, faceFor(action));
  assert.equal(bridge.ask('GetActionText', action.name).text, '+ tab');
  // Tab number is drawn and the project band is present.
  assert.ok(hasNumber(image));
  assert.ok(count(image, 0, BAND_Y, 80, BAND_Y + BAND_HEIGHT, isBand) > 0);
});

test('empty Space, Agent and Recent keys show only the slot number and the dotted ring', () => {
  for (const action of [new SpaceAction(4), new AgentAction(5), new RecentAgentAction(6)]) {
    action.update(EMPTY_SNAPSHOT);
    const image = faceFor(action);
    assert.ok(hasNumber(image), `${action.name} shows its number`);
    assert.equal(count(image, 0, BAND_Y, 80, BAND_Y + BAND_HEIGHT, isBand), 0, `${action.name} has no band`);
    assert.equal(action.status, 'none');
  }
});

test('offline keys show the offline ring and no number', () => {
  const actions = [new SpaceAction(1), new AgentAction(2), new NewTabAction(3)];
  applySnapshot(actions, undefined, () => {});
  for (const action of actions) {
    const image = faceFor(action);
    assert.equal(action.status, 'offline');
    assert.ok(!hasNumber(image), `${action.name} has no number`);
    const [r, g, b] = styleFor('offline').rgb;
    const { at } = decode(image);
    let ring = 0;
    for (let y = 0; y < BAND_Y; y++) for (let x = 0; x < 80; x++) {
      const p = at(x, y);
      if (!isBlack(p)) {
        ring++;
        assert.deepEqual(p.slice(0, 3), [r, g, b]);
      }
    }
    assert.ok(ring > 0);
  }
});

test('long, accented, CJK and astral names still produce a valid 80x80 face', () => {
  const titles = [
    'p'.repeat(40),
    's'.repeat(80),
    'Écoute café — naïve',
    '日本語のプロジェクト名前',
    '😀😀😀 rocket 🚀🚀🚀 \u{1F9D1}\u200d\u{1F4BB}',
    'a\ud800b',
  ];
  for (const title of titles) {
    const space = new SpaceAction(1);
    assert.doesNotThrow(() => space.update(snap(title, [agentFx(title)])));
    const { width, height } = decode(faceFor(space));
    assert.deepEqual([width, height], [80, 80]);
    const tab = new NewTabAction(1);
    tab.update(snap(title));
    assert.equal(decode(faceFor(tab)).width, 80);
  }
});

test('rapid updates notify only on real face changes', () => {
  const space = new SpaceAction(1);
  let events: string[] = [];
  const notify = (event: string, name: string) => void events.push(`${event} ${name}`);
  applySnapshot([space], snap(), notify);
  events = [];

  applySnapshot([space], snap(), notify);
  applySnapshot([space], snap(), notify);
  assert.deepEqual(events, [], 'identical snapshots emit nothing');

  for (let i = 0; i < 500; i++) {
    events = [];
    applySnapshot([space], snap('web', [agentFx(`title ${i}`)]), notify);
    assert.deepEqual(events, [`ActionImageChanged ${space.name}`, `ActionTextChanged ${space.name}`]);
    assert.ok(faceFor(space).length > 0);
  }
});

test('the ring of every status keeps its color and style', () => {
  const statuses: TileStatus[] = ['blocked', 'working', 'done', 'idle', 'unknown', 'none', 'offline'];
  for (const status of statuses) {
    const action = new SpaceAction(1);
    action.update(snap());
    action.status = status;
    const face = decode(faceFor(action));
    const { rgb, style } = styleFor(status);
    let ring = 0;
    for (let y = 0; y < BAND_Y; y++) {
      for (let x = 0; x < 80; x++) {
        const p = face.at(x, y);
        if (inHole(x, y)) continue; // tab number
        if (!isBlack(p)) {
          ring++;
          assert.deepEqual(p.slice(0, 3), rgb, `${status} (${x},${y})`);
        }
      }
    }
    assert.ok(ring > 0, status);
    const centre = !isBlack(face.at(RING_CX, PROBE_Y));
    assert.equal(centre, style === 'filled', `${status} centre`);
  }
});

test('New-tab key image holds the project in the band; the service text carries + tab', () => {
  const tab = new NewTabAction(3);
  tab.update({ ...EMPTY_SNAPSHOT, workspaces: new Map([[3, {
    workspace_id: 'w3', active_tab_id: 'w3:t1', number: 3,
    label: 'web', agent_status: 'idle',
  }]]) });
  const image = faceFor(tab);
  assert.ok(isBand(decode(image).at(0, 79)), 'band is flush to the bottom edge');
  assert.ok(count(image, 0, BAND_Y, 80, BAND_Y + BAND_HEIGHT, (p) => !isBand(p)) > 0, 'project is drawn in the band');
});

test('a long session never reaches the image; it is cut in the service text', () => {
  const space = new SpaceAction(1);
  space.update(snap('web', [agentFx('x'.repeat(20))]));
  const bridge = fakeBridge([space]);
  const text = bridge.ask('GetActionText', space.name).text!;
  assert.ok(text.endsWith('\u2026') && Array.from(text).length < 20);
  assert.ok(!text.includes('web'));
});

test('empty and offline keys draw no band and answer blank service text', () => {
  const empty = new SpaceAction(4);
  empty.update(EMPTY_SNAPSHOT);
  assert.equal(count(faceFor(empty), 0, BAND_Y, 80, 80, (p) => !isBlack(p)), 0);
  const offline = new AgentAction(2);
  applySnapshot([offline], undefined, () => {});
  assert.equal(count(faceFor(offline), 0, BAND_Y, 80, 80, (p) => !isBlack(p)), 0);
  const bridge = fakeBridge([empty, offline]);
  assert.equal(bridge.ask('GetActionText', empty.name).text, '\u200b');
  assert.equal(bridge.ask('GetActionText', offline.name).text, '\u200b');
});

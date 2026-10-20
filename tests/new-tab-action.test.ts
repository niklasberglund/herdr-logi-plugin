import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'herdr-logi-new-tab-'));
const socketPath = join(dir, 'h.sock');
const configPath = join(dir, 'config.json');
process.env.HERDR_SOCKET_PATH = socketPath;
process.env.HERDR_LOGI_CONFIG = configPath;

const { NewTabAction } = await import('../src/actions.ts');
const { EMPTY_SNAPSHOT, request } = await import('../src/herdr.ts');

let server: Server;
let socketHandler: (socket: Socket, line: string) => void = () => {};

before(async () => {
  server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\n');
      if (end !== -1) socketHandler(socket, buffer.slice(0, end));
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
});

after(() => server.close());

function reply(socket: Socket, id: string, result: unknown) {
  socket.end(JSON.stringify({ id, result }) + '\n');
}

function snapshot(workspaceNumber: number) {
  return {
    snapshot: {
      version: '0.9.3', protocol: 20,
      workspaces: [{
        workspace_id: `w${workspaceNumber}`, active_tab_id: `w${workspaceNumber}:t1`,
        number: workspaceNumber, label: 'my-project', agent_status: 'idle',
      }],
      agents: [], layouts: [],
    },
  };
}

test('Tabs actions keep their existing IDs and show the target workspace', () => {
  const action = new NewTabAction(3);
  assert.equal(action.name, 'herdr_new_3');
  assert.equal(action.groupName, 'Tabs');
  assert.equal(action.displayName, 'New tab space 3');
  action.update({ ...EMPTY_SNAPSHOT, workspaces: new Map([[3, {
    workspace_id: 'w3', active_tab_id: 'w3:t1', number: 3,
    label: 'my-project', agent_status: 'idle',
  }]]) });
  assert.equal(action.label, '+ tab my-project');
  action.update(EMPTY_SNAPSHOT);
  assert.equal(action.label, '+ tab Space 3');
});

test('New-tab keys carry face data: tab number, project and a + tab marker', () => {
  const action = new NewTabAction(3);
  action.update({ ...EMPTY_SNAPSHOT, workspaces: new Map([[3, {
    workspace_id: 'w3', active_tab_id: 'w3:t1', number: 3,
    label: 'my-project', agent_status: 'idle',
  }]]) });
  assert.deepEqual(action.face, { tab: 3, project: 'my-project', session: '+ tab' });
  assert.equal(action.status, 'idle');
  action.update(EMPTY_SNAPSHOT);
  assert.deepEqual(action.face, { tab: 3, project: '', session: '' });
  assert.equal(action.status, 'none');
});

test('a press creates only a focused, auto-numbered shell tab even with an agent in config', async () => {
  writeFileSync(configPath, JSON.stringify({ newSessionAgent: 'codex' }));
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  socketHandler = (socket, line) => {
    const { id, method, params } = JSON.parse(line);
    calls.push({ method, params });
    if (method === 'session.snapshot') reply(socket, id, snapshot(3));
    if (method === 'tab.create') reply(socket, id, { tab_id: 'w3:t2', root_pane: { pane_id: 'w3:p2' } });
  };

  await new NewTabAction(3).onKeyDown();

  assert.deepEqual(calls.map((call) => call.method), ['session.snapshot', 'tab.create']);
  assert.deepEqual(calls[1].params, { workspace_id: 'w3', focus: true });
});

test('all nine buttons target their matching workspace', async () => {
  for (let n = 1; n <= 9; n++) {
    const calls: string[] = [];
    socketHandler = (socket, line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === 'session.snapshot') reply(socket, id, snapshot(n));
      if (method === 'tab.create') {
        calls.push(params.workspace_id);
        reply(socket, id, { tab_id: `w${n}:t2` });
      }
    };
    await new NewTabAction(n).onKeyDown();
    assert.deepEqual(calls, [`w${n}`]);
  }
});

test('a missing workspace stops before tab creation', async () => {
  const methods: string[] = [];
  socketHandler = (socket, line) => {
    const { id, method } = JSON.parse(line);
    methods.push(method);
    if (method === 'session.snapshot') reply(socket, id, snapshot(2));
  };

  await new NewTabAction(5).onKeyDown();

  assert.deepEqual(methods, ['session.snapshot']);
});

test('a tab creation error does not start an agent', async () => {
  const methods: string[] = [];
  socketHandler = (socket, line) => {
    const { id, method } = JSON.parse(line);
    methods.push(method);
    if (method === 'session.snapshot') reply(socket, id, snapshot(1));
    if (method === 'tab.create') socket.end(JSON.stringify({ id, error: { code: 'workspace_not_found' } }) + '\n');
  };

  await new NewTabAction(1).onKeyDown();

  assert.deepEqual(methods, ['session.snapshot', 'tab.create']);
});

test('request timeout override still rejects stalled socket calls', async () => {
  socketHandler = () => {};
  await assert.rejects(() => request('session.snapshot', {}, 100), /timed out/);
});

test('each Tabs action has an icon', () => {
  for (let n = 1; n <= 9; n++) {
    const path = new URL(`../package/actionicons/herdr_new_${n}.svg`, import.meta.url).pathname;
    assert.ok(existsSync(path), `missing icon for tab ${n}`);
  }
});

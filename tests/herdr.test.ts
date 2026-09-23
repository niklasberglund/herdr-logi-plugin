import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// The socket path is read when the module loads, so point it at a scratch
// socket before importing.
const dir = mkdtempSync(join(tmpdir(), 'herdr-logi-'));
const socketPath = join(dir, 'h.sock');
process.env.HERDR_SOCKET_PATH = socketPath;
const {
  comparePaneIds,
  installedTerminalBundle,
  loadConfig,
  nextPaneInFocusedWorkspace,
  request,
  runningTerminalBundleFromProcessTable,
  terminalBundleFromProcessTable,
} = await import('../src/herdr.ts');
type Snapshot = import('../src/herdr.ts').Snapshot;

test('pane ids compare by their numeric parts', () => {
  const sorted = ['w1:p10', 'w1:p2', 'w1:p1', 'w10:p1', 'w2:p1'].sort(comparePaneIds);
  assert.deepEqual(sorted, ['w1:p1', 'w1:p2', 'w1:p10', 'w2:p1', 'w10:p1']);
});

function snapshot(focusedWorkspaceId: string | undefined, focusedPane: string, panes: string[]): Snapshot {
  return {
    focusedWorkspaceId,
    workspaces: new Map([
      [1, { workspace_id: 'w1', active_tab_id: 'w1:t1', number: 1, label: 'one', agent_status: 'idle' }],
    ]),
    agents: [],
    recent: [],
    layouts: new Map([
      ['w1:t1', { tab_id: 'w1:t1', focused_pane_id: focusedPane, panes: panes.map((pane_id) => ({ pane_id })) }],
    ]),
  };
}

test('cycles to the next pane only when the workspace is already focused', () => {
  assert.equal(nextPaneInFocusedWorkspace(snapshot('w1', 'w1:p1', ['w1:p1', 'w1:p2']), 'w1'), 'w1:p2');
  assert.equal(nextPaneInFocusedWorkspace(snapshot('w1', 'w1:p2', ['w1:p1', 'w1:p2']), 'w1'), 'w1:p1', 'wraps');
  assert.equal(nextPaneInFocusedWorkspace(snapshot('w2', 'w1:p1', ['w1:p1', 'w1:p2']), 'w1'), undefined, 'not focused');
  assert.equal(nextPaneInFocusedWorkspace(snapshot('w1', 'w1:p1', ['w1:p1']), 'w1'), undefined, 'single pane');
});

test('config defaults to auto-detection and accepts a terminalApp override', () => {
  assert.deepEqual(loadConfig(join(dir, 'missing.json')), { terminalApp: undefined });
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ terminalApp: 'Ghostty' }));
  assert.deepEqual(loadConfig(path), { terminalApp: 'Ghostty' });
  writeFileSync(path, JSON.stringify({ terminalApp: '' }));
  assert.deepEqual(loadConfig(path), { terminalApp: '' }, 'empty string disables activation');
  writeFileSync(path, JSON.stringify({ terminalApp: 42 }));
  assert.deepEqual(loadConfig(path), { terminalApp: undefined }, 'non-string value is ignored');
  writeFileSync(path, '{not json');
  assert.deepEqual(loadConfig(path), { terminalApp: undefined }, 'malformed file is ignored');
});

const table = (rows: [number, number, string][]) => rows.map((r) => r.join(' ')).join('\n') + '\n';

test('finds the terminal bundle above the herdr client, ignoring the server', () => {
  const iterm = table([
    [1, 0, '/sbin/launchd'],
    [17297, 1, '/Users/n/.local/bin/herdr'],
    [25172, 1, '/Applications/iTerm.app/Contents/MacOS/iTerm2'],
    [25174, 25172, '/Users/n/Library/Application Support/iTerm2/iTermServer-3.6.9'],
    [25490, 25174, '/usr/bin/login'],
    [25502, 25490, '-zsh'],
    [87506, 25502, 'herdr'],
  ]);
  assert.equal(terminalBundleFromProcessTable(iterm), '/Applications/iTerm.app');

  const ghostty = table([
    [17297, 1, '/Users/n/.local/bin/herdr'],
    [900, 1, '/Applications/Ghostty.app/Contents/MacOS/ghostty'],
    [901, 900, '/usr/bin/login'],
    [902, 901, '-zsh'],
    [903, 902, '/opt/homebrew/bin/herdr'],
  ]);
  assert.equal(terminalBundleFromProcessTable(ghostty), '/Applications/Ghostty.app');
});

test('the newest client wins and an xpc helper resolves to its outer bundle', () => {
  const two = table([
    [10, 1, '/Applications/Warp.app/Contents/MacOS/stable'],
    [11, 10, '-zsh'],
    [12, 11, 'herdr'],
    [20, 1, '/Applications/kitty.app/Contents/MacOS/kitty'],
    [21, 20, '-zsh'],
    [22, 21, 'herdr'],
  ]);
  assert.equal(terminalBundleFromProcessTable(two), '/Applications/kitty.app');

  const xpc = table([
    [30, 1, '/Applications/iTerm.app/Contents/XPCServices/pidinfo.xpc/Contents/MacOS/pidinfo'],
    [31, 30, 'herdr'],
  ]);
  assert.equal(terminalBundleFromProcessTable(xpc), '/Applications/iTerm.app');
});

test('no terminal is found when only the server runs or the chain is broken', () => {
  assert.equal(terminalBundleFromProcessTable(table([[17297, 1, '/Users/n/.local/bin/herdr']])), undefined);
  assert.equal(terminalBundleFromProcessTable(table([[5, 4, 'herdr']])), undefined, 'missing parent');
  assert.equal(terminalBundleFromProcessTable(''), undefined);
});

test('falls back to a known terminal that is running, by preference', () => {
  const running = table([
    [1, 0, '/sbin/launchd'],
    [40, 1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
    [41, 1, '/Users/n/Applications/WezTerm.app/Contents/MacOS/wezterm-gui'],
    [42, 1, '/Applications/Slack.app/Contents/MacOS/Slack'],
  ]);
  assert.equal(runningTerminalBundleFromProcessTable(running), '/Users/n/Applications/WezTerm.app');
  assert.equal(runningTerminalBundleFromProcessTable(table([[42, 1, '/Applications/Slack.app/Contents/MacOS/Slack']])), undefined);
  assert.equal(runningTerminalBundleFromProcessTable(''), undefined);
});

test('falls back to an installed known terminal, ending with Terminal.app', () => {
  const installed = (paths: string[]) => (path: string) => paths.includes(path);
  const home = '/Users/n';
  assert.equal(
    installedTerminalBundle(installed(['/Applications/Ghostty.app', '/Applications/Alacritty.app']), home),
    '/Applications/Ghostty.app',
  );
  assert.equal(installedTerminalBundle(installed(['/Users/n/Applications/kitty.app']), home), '/Users/n/Applications/kitty.app');
  assert.equal(
    installedTerminalBundle(installed(['/System/Applications/Utilities/Terminal.app']), home),
    '/System/Applications/Utilities/Terminal.app',
  );
  assert.equal(installedTerminalBundle(() => false, home), undefined);
});

let server: Server;
let behaviour: (socket: Socket, line: string) => void;

before(async () => {
  server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end !== -1) behaviour(socket, buffer.slice(0, end));
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
});

after(() => server.close());

test('a request gets its result back', async () => {
  behaviour = (socket, line) => {
    const { id, method, params } = JSON.parse(line);
    socket.end(JSON.stringify({ id, result: { echo: { method, params } } }) + '\n');
  };
  assert.deepEqual(await request('pane.focus', { pane_id: 'w1:p1' }), {
    echo: { method: 'pane.focus', params: { pane_id: 'w1:p1' } },
  });
});

test('an error reply rejects', async () => {
  behaviour = (socket, line) => {
    const { id } = JSON.parse(line);
    socket.end(JSON.stringify({ id, error: { code: 'not_found' } }) + '\n');
  };
  await assert.rejects(request('pane.focus'), /not_found/);
});

test('a multi-byte character split across chunks arrives intact', async () => {
  behaviour = (socket, line) => {
    const { id } = JSON.parse(line);
    const reply = Buffer.from(JSON.stringify({ id, result: { title: '✳ fix-login' } }) + '\n');
    const split = reply.indexOf(Buffer.from('✳')) + 1;
    socket.write(reply.subarray(0, split));
    setTimeout(() => socket.end(reply.subarray(split)), 20);
  };
  assert.deepEqual(await request('session.snapshot'), { title: '✳ fix-login' });
});

test('a connection closed without a reply rejects instead of hanging', async () => {
  behaviour = (socket) => socket.end();
  await assert.rejects(request('session.snapshot'), /closed before a response/);
});

test('a malformed reply rejects instead of crashing', async () => {
  behaviour = (socket) => socket.end('{oops\n');
  await assert.rejects(request('session.snapshot'), /malformed/);
});

test('a missing socket rejects', async () => {
  process.env.HERDR_SOCKET_PATH = join(dir, 'nope.sock');
  await assert.rejects(request('session.snapshot'));
});

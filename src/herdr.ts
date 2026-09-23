import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createConnection } from 'net';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { recency } from './recency.ts';

export const SOCKET_PATH = process.env.HERDR_SOCKET_PATH ?? join(homedir(), '.config/herdr/herdr.sock');
export const CONFIG_PATH =
  process.env.HERDR_LOGI_CONFIG ?? join(homedir(), '.config/herdr-logi-plugin/config.json');

// The herdr socket protocol this plugin was written and tested against (herdr 0.8.2).
export const TESTED_PROTOCOL = 20;
const REQUEST_TIMEOUT_MS = 3000;

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type Workspace = {
  workspace_id: string;
  active_tab_id: string;
  number: number;
  label: string;
  agent_status: AgentStatus;
};

export type Agent = {
  pane_id: string;
  workspace_id: string;
  agent: string;
  agent_status: AgentStatus;
  terminal_title_stripped: string;
};

export type Layout = {
  tab_id: string;
  focused_pane_id: string;
  panes: { pane_id: string }[];
};

export type Snapshot = {
  focusedWorkspaceId: string | undefined;
  workspaces: Map<number, Workspace>;
  agents: Agent[];
  recent: Agent[];
  layouts: Map<string, Layout>;
};

export const EMPTY_SNAPSHOT: Snapshot = {
  focusedWorkspaceId: undefined,
  workspaces: new Map(),
  agents: [],
  recent: [],
  layouts: new Map(),
};

type RawSnapshot = {
  version: string;
  protocol: number;
  focused_workspace_id?: string;
  workspaces: Workspace[];
  agents: Agent[];
  layouts: Layout[];
};

let nextId = 0;

// One request per connection: herdr answers with a single JSON line.
export function request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `logi_${++nextId}`;
    const socket = createConnection(SOCKET_PATH);
    // Decode as a stream so a multi-byte character split across chunks survives.
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      socket.destroy();
    };
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => fail(new Error(`herdr ${method}: timed out`)));
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      let message: { error?: unknown; result?: T };
      try {
        message = JSON.parse(buffer.slice(0, end));
      } catch {
        return fail(new Error(`herdr ${method}: malformed response`));
      }
      settled = true;
      socket.end();
      if (message.error) reject(new Error(`herdr ${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result as T);
    });
    socket.on('error', fail);
    socket.on('close', () => fail(new Error(`herdr ${method}: connection closed before a response arrived`)));
  });
}

// Pane ids look like `w1:p10`; compare their numeric parts so p10 sorts after p2.
export function comparePaneIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

let warnedProtocol = false;

export async function getSnapshot(): Promise<Snapshot> {
  const { snapshot } = await request<{ snapshot: RawSnapshot }>('session.snapshot');
  if (snapshot.protocol !== TESTED_PROTOCOL && !warnedProtocol) {
    warnedProtocol = true;
    console.warn(
      `herdr ${snapshot.version} speaks socket protocol ${snapshot.protocol}; this plugin was tested against protocol ${TESTED_PROTOCOL}`,
    );
  }
  const workspaces = new Map(snapshot.workspaces.map((w) => [w.number, w]));
  const numberOf = new Map([...workspaces.values()].map((w) => [w.workspace_id, w.number]));
  const agents = [...snapshot.agents].sort(
    (a, b) =>
      (numberOf.get(a.workspace_id) ?? 0) - (numberOf.get(b.workspace_id) ?? 0) || comparePaneIds(a.pane_id, b.pane_id),
  );
  const layouts = new Map(snapshot.layouts.map((l) => [l.tab_id, l]));
  return { focusedWorkspaceId: snapshot.focused_workspace_id, workspaces, agents, recent: recency.rank(agents), layouts };
}

export type Config = {
  // macOS application to bring to the front when a tile is pressed: a name or
  // .app path for `open -a`. Undefined detects the terminal that runs the herdr
  // client; an empty string disables the activation step.
  terminalApp: string | undefined;
};

export function loadConfig(path = CONFIG_PATH): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const terminalApp = (parsed as { terminalApp?: unknown })?.terminalApp;
    return { terminalApp: typeof terminalApp === 'string' ? terminalApp : undefined };
  } catch {
    return { terminalApp: undefined };
  }
}

// Terminal emulators recognised when the herdr client cannot be traced to its
// host app, in order of preference. Terminal ships with macOS, so it is last
// and always available.
export const KNOWN_TERMINALS = ['iTerm', 'Ghostty', 'WezTerm', 'kitty', 'Warp', 'Alacritty', 'Rio', 'Hyper', 'Tabby', 'Terminal'];

type ProcessTable = Map<number, { ppid: number; comm: string }>;

// Parses `ps -axo pid=,ppid=,comm=` output.
export function parseProcessTable(table: string): ProcessTable {
  const processes: ProcessTable = new Map();
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) processes.set(Number(match[1]), { ppid: Number(match[2]), comm: match[3] });
  }
  return processes;
}

// Walks up from each herdr client process to the first ancestor that lives
// inside an .app bundle and returns that bundle's path. The herdr server is not
// inside a terminal, so it never matches. The newest client wins when several
// terminals are attached.
export function terminalBundleFromProcessTable(table: string | ProcessTable): string | undefined {
  const processes = typeof table === 'string' ? parseProcessTable(table) : table;
  const clients = [...processes]
    .filter(([, { comm }]) => comm === 'herdr' || comm.endsWith('/herdr'))
    .map(([pid]) => pid)
    .sort((a, b) => b - a);
  for (const client of clients) {
    const visited = new Set<number>();
    for (let pid = client; pid > 1 && !visited.has(pid); ) {
      visited.add(pid);
      const process = processes.get(pid);
      if (!process) break;
      const bundle = /^(.*?\.app)\//.exec(process.comm)?.[1];
      if (bundle) return bundle;
      pid = process.ppid;
    }
  }
  return undefined;
}

// The most preferred known terminal that has a process running, wherever its
// bundle is installed.
export function runningTerminalBundleFromProcessTable(table: string | ProcessTable): string | undefined {
  const processes = typeof table === 'string' ? parseProcessTable(table) : table;
  const comms = [...processes.values()].map((p) => p.comm);
  for (const name of KNOWN_TERMINALS) {
    const pattern = new RegExp(`^(.*?/${name}\\.app)/`);
    for (const comm of comms) {
      const bundle = pattern.exec(comm)?.[1];
      if (bundle) return bundle;
    }
  }
  return undefined;
}

// The most preferred known terminal installed in the usual places.
export function installedTerminalBundle(exists: (path: string) => boolean = existsSync, home = homedir()): string | undefined {
  const roots = ['/Applications', join(home, 'Applications'), '/System/Applications/Utilities', '/Applications/Utilities'];
  for (const name of KNOWN_TERMINALS) {
    for (const root of roots) {
      const bundle = join(root, `${name}.app`);
      if (exists(bundle)) return bundle;
    }
  }
  return undefined;
}

const run = promisify(execFile);

const DETECT_CACHE_MS = 30_000;
let detected: { bundle: string | undefined; at: number } | undefined;

// The terminal to raise, in order: the app hosting the herdr client, then a
// known terminal that is running, then a known terminal that is installed.
export async function detectTerminalBundle(): Promise<string | undefined> {
  if (detected && Date.now() - detected.at < DETECT_CACHE_MS) return detected.bundle;
  let bundle: string | undefined;
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,comm=']);
    const processes = parseProcessTable(stdout);
    bundle = terminalBundleFromProcessTable(processes) ?? runningTerminalBundleFromProcessTable(processes);
  } catch {
    bundle = undefined;
  }
  bundle ??= installedTerminalBundle();
  detected = { bundle, at: Date.now() };
  return bundle;
}

async function activateTerminal() {
  const { terminalApp } = loadConfig();
  if (terminalApp === '') return;
  const target = terminalApp ?? (await detectTerminalBundle());
  if (!target) return;
  await run('open', ['-a', target]);
}

export async function focusWorkspace(workspaceId: string): Promise<void> {
  activateTerminal().catch(() => {});
  await request('workspace.focus', { workspace_id: workspaceId });
}

export async function focusPane(paneId: string): Promise<void> {
  activateTerminal().catch(() => {});
  await request('pane.focus', { pane_id: paneId });
}

export function nextPaneInFocusedWorkspace(snapshot: Snapshot, workspaceId: string): string | undefined {
  if (snapshot.focusedWorkspaceId !== workspaceId) return undefined;
  const workspace = [...snapshot.workspaces.values()].find((w) => w.workspace_id === workspaceId);
  const layout = workspace && snapshot.layouts.get(workspace.active_tab_id);
  if (!layout || layout.panes.length < 2) return undefined;
  const index = layout.panes.findIndex((p) => p.pane_id === layout.focused_pane_id);
  return layout.panes[(index + 1) % layout.panes.length].pane_id;
}

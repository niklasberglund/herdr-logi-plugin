import { execFile } from 'child_process';
import { createConnection } from 'net';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const SOCKET_PATH = process.env.HERDR_SOCKET_PATH ?? join(homedir(), '.config/herdr/herdr.sock');

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

type Layout = {
  tab_id: string;
  focused_pane_id: string;
  panes: { pane_id: string }[];
};

export type Snapshot = {
  focusedWorkspaceId: string | undefined;
  workspaces: Map<number, Workspace>;
  agents: Agent[];
  layouts: Map<string, Layout>;
};

let nextId = 0;

function request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `logi_${++nextId}`;
    const socket = createConnection(SOCKET_PATH);
    let buffer = '';
    socket.setTimeout(3000, () => socket.destroy(new Error(`herdr ${method}: timeout`)));
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      socket.end();
      const message = JSON.parse(buffer.slice(0, end));
      if (message.error) reject(new Error(`herdr ${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result as T);
    });
    socket.on('error', reject);
  });
}

export async function getSnapshot(): Promise<Snapshot> {
  const { snapshot } = await request<{ snapshot: any }>('session.snapshot');
  const workspaces = new Map<number, Workspace>((snapshot.workspaces as Workspace[]).map((w) => [w.number, w]));
  const numberOf = new Map([...workspaces.values()].map((w) => [w.workspace_id, w.number]));
  const agents = [...(snapshot.agents as Agent[])].sort(
    (a, b) => (numberOf.get(a.workspace_id) ?? 0) - (numberOf.get(b.workspace_id) ?? 0) || a.pane_id.localeCompare(b.pane_id),
  );
  const layouts = new Map<string, Layout>((snapshot.layouts as Layout[]).map((l) => [l.tab_id, l]));
  return { focusedWorkspaceId: snapshot.focused_workspace_id, workspaces, agents, layouts };
}

const run = promisify(execFile);

function activateTerminal() {
  run('osascript', ['-e', 'tell application "iTerm" to activate']).catch(() => {});
}

export async function focusWorkspace(workspaceId: string): Promise<void> {
  activateTerminal();
  await request('workspace.focus', { workspace_id: workspaceId });
}

export async function focusPane(paneId: string): Promise<void> {
  activateTerminal();
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

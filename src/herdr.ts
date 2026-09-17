import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

// The Plugin Service launches us with a minimal PATH that lacks user-local bins.
const HERDR = [join(homedir(), '.local/bin/herdr'), '/opt/homebrew/bin/herdr', '/usr/local/bin/herdr']
  .find(existsSync) ?? 'herdr';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type Workspace = {
  workspace_id: string;
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

export type Snapshot = {
  workspaces: Map<number, Workspace>;
  agents: Agent[];
};

export async function getSnapshot(): Promise<Snapshot> {
  const { stdout } = await run(HERDR, ['api', 'snapshot'], { maxBuffer: 16 * 1024 * 1024 });
  const snapshot = JSON.parse(stdout).result.snapshot;
  const workspaces = new Map<number, Workspace>((snapshot.workspaces as Workspace[]).map((w) => [w.number, w]));
  const numberOf = new Map([...workspaces.values()].map((w) => [w.workspace_id, w.number]));
  const agents = [...(snapshot.agents as Agent[])].sort(
    (a, b) => (numberOf.get(a.workspace_id) ?? 0) - (numberOf.get(b.workspace_id) ?? 0) || a.pane_id.localeCompare(b.pane_id),
  );
  return { workspaces, agents };
}

async function activateTerminal() {
  await run('osascript', ['-e', 'tell application "iTerm" to activate']);
}

export async function focusWorkspace(workspaceId: string): Promise<void> {
  await activateTerminal();
  await run(HERDR, ['workspace', 'focus', workspaceId]);
}

export async function focusAgent(paneId: string): Promise<void> {
  await activateTerminal();
  await run(HERDR, ['agent', 'focus', paneId]);
}

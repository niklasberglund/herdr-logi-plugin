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

export async function getWorkspaces(): Promise<Map<number, Workspace>> {
  const { stdout } = await run(HERDR, ['api', 'snapshot'], { maxBuffer: 16 * 1024 * 1024 });
  const workspaces: Workspace[] = JSON.parse(stdout).result.snapshot.workspaces;
  return new Map(workspaces.map((w) => [w.number, w]));
}

export async function focusWorkspace(workspaceId: string): Promise<void> {
  await run('osascript', ['-e', 'tell application "iTerm" to activate']);
  await run(HERDR, ['workspace', 'focus', workspaceId]);
}

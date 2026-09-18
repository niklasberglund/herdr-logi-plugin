import { CommandAction } from '@logitech/plugin-sdk';
import {
  focusPane,
  focusWorkspace,
  getSnapshot,
  nextPaneInFocusedWorkspace,
  type AgentStatus,
  type Snapshot,
} from './herdr';

export const SLOT_COUNT = 9;

export type TileStatus = AgentStatus | 'none';

// Presses are applied one at a time so rapid taps each see the focus state
// left by the previous one instead of racing on a stale snapshot.
let pressQueue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  pressQueue = pressQueue.then(task, task);
  return pressQueue;
}

export abstract class SlotAction extends CommandAction {
  readonly name: string;
  displayName: string;
  description: string;
  groupName = 'Herdr';
  status: TileStatus = 'none';
  label: string;

  constructor(kind: string, readonly slot: number, description: string) {
    super();
    this.name = `herdr_${kind.toLowerCase()}_${slot}`;
    this.displayName = `${kind} ${slot}`;
    this.label = '';
    this.description = description;
  }

  abstract update(snapshot: Snapshot): void;
}

export class SpaceAction extends SlotAction {
  private workspaceId: string | undefined;

  constructor(slot: number) {
    super('Space', slot, `Status of herdr workspace ${slot}; press to focus it, press again to cycle its panes`);
  }

  update({ workspaces }: Snapshot) {
    const workspace = workspaces.get(this.slot);
    this.workspaceId = workspace?.workspace_id;
    this.status = workspace?.agent_status ?? 'none';
    this.label = workspace?.label || '';
  }

  onKeyDown() {
    const workspaceId = this.workspaceId;
    if (!workspaceId) return;
    return enqueue(async () => {
      const nextPaneId = nextPaneInFocusedWorkspace(await getSnapshot(), workspaceId);
      if (nextPaneId) await focusPane(nextPaneId);
      else await focusWorkspace(workspaceId);
    });
  }
}

export class AgentAction extends SlotAction {
  private paneId: string | undefined;

  constructor(slot: number) {
    super('Agent', slot, `Status of the ${slot}th running herdr agent; press to focus it`);
  }

  update({ agents }: Snapshot) {
    const agent = agents[this.slot - 1];
    this.paneId = agent?.pane_id;
    this.status = agent?.agent_status ?? 'none';
    this.label = agent?.terminal_title_stripped || '';
  }

  onKeyDown() {
    const paneId = this.paneId;
    if (!paneId) return;
    return enqueue(() => focusPane(paneId));
  }
}

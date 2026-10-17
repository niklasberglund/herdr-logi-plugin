import { CommandAction } from '@logitech/plugin-sdk';
import {
  activateTerminal,
  focusPane,
  focusWorkspace,
  getSnapshot,
  nextPaneInFocusedWorkspace,
  request,
  type Agent,
  type AgentStatus,
  type Snapshot,
} from './herdr.ts';

export const SLOT_COUNT = 9;

// `none`: nothing occupies the slot. `offline`: herdr cannot be reached.
export type TileStatus = AgentStatus | 'none' | 'offline';

export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]);
}

// Presses are applied one at a time so rapid taps each see the focus state
// left by the previous one instead of racing on a stale snapshot.
let pressQueue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  pressQueue = pressQueue.then(task, task);
  return pressQueue;
}

export abstract class SlotAction extends CommandAction {
  readonly name: string;
  readonly slot: number;
  displayName: string;
  description: string;
  groupName: string;
  status: TileStatus = 'none';
  label: string;
  // Shown while nothing occupies the slot. Options+ reserves the label row
  // either way, so a blank label leaves the ring looking too high on the key.
  readonly placeholder: string;

  constructor(kind: string, slot: number, description: string, groupName: string) {
    super();
    this.slot = slot;
    this.groupName = groupName;
    this.name = `herdr_${kind.toLowerCase()}_${slot}`;
    this.displayName = `${kind} ${slot}`;
    this.placeholder = `${kind} ${slot}`;
    this.label = this.placeholder;
    this.description = description;
  }

  abstract update(snapshot: Snapshot): void;
}

export class SpaceAction extends SlotAction {
  private workspaceId: string | undefined;

  constructor(slot: number) {
    super(
      'Space',
      slot,
      `Status of herdr workspace ${slot}; press to focus it, press again to cycle its panes`,
      'Spaces',
    );
  }

  update({ workspaces }: Snapshot) {
    const workspace = workspaces.get(this.slot);
    this.workspaceId = workspace?.workspace_id;
    this.status = workspace?.agent_status ?? 'none';
    this.label = workspace?.label || this.placeholder;
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

  constructor(
    slot: number,
    kind = 'Agent',
    description = `Status of the ${ordinal(slot)} running herdr agent; press to focus it`,
    groupName = 'Agents',
  ) {
    super(kind, slot, description, groupName);
  }

  update({ agents }: Snapshot) {
    this.apply(agents);
  }

  protected apply(agents: Agent[]) {
    const agent = agents[this.slot - 1];
    this.paneId = agent?.pane_id;
    this.status = agent?.agent_status ?? 'none';
    this.label = agent?.terminal_title_stripped || this.placeholder;
  }

  onKeyDown() {
    const paneId = this.paneId;
    if (!paneId) return;
    return enqueue(() => focusPane(paneId));
  }
}

// The most recently active agents, so a handful of keys can cover a session
// running more agents than there are tiles.
export class RecentAgentAction extends AgentAction {
  constructor(slot: number) {
    super(
      slot,
      'Recent',
      `Status of the ${ordinal(slot)} most recently active herdr agent; press to focus it`,
      'Recent Agents',
    );
    this.displayName = `Recent Agent ${slot}`;
  }

  update({ recent }: Snapshot) {
    this.apply(recent);
  }
}

const NEW_TAB_TIMEOUT_MS = 10_000;

/**
 * Creates a shell tab in the workspace whose number matches the slot (1–9).
 * Keep the action IDs so existing keypad assignments continue to work.
 */
export class NewTabAction extends SlotAction {
  constructor(slot: number) {
    super(
      'New',
      slot,
      `Create a new shell tab in herdr workspace ${slot}`,
      'Tabs',
    );
    this.displayName = `New tab space ${slot}`;
    this.label = `+ tab Space ${slot}`;
  }

  /** Green outline when the workspace exists, dotted when absent. */
  update({ workspaces }: Snapshot): void {
    const workspace = workspaces.get(this.slot);
    this.status = workspace ? 'idle' : 'none';
    this.label = `+ tab ${workspace?.label || `Space ${this.slot}`}`;
  }

  onKeyDown(): Promise<void> | void {
    const slot = this.slot;
    return enqueue(() => this.#run(slot));
  }

  async #run(targetSpace: number): Promise<void> {
    try {
      await activateTerminal();
    } catch (err) {
      console.warn(`NewTabAction: terminal activation failed (continuing): ${(err as Error).message}`);
    }

    let snapshot: Snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      console.error(`NewTabAction: session.snapshot failed: ${(err as Error).message}`);
      return;
    }

    const workspace = snapshot.workspaces.get(targetSpace);
    if (!workspace) {
      console.error(`NewTabAction: no workspace with number ${targetSpace}`);
      return;
    }

    try {
      // Omitting label lets herdr assign its sequential numeric tab label.
      await request(
        'tab.create',
        { workspace_id: workspace.workspace_id, focus: true },
        NEW_TAB_TIMEOUT_MS,
      );
    } catch (err) {
      console.error(`NewTabAction: tab.create failed: ${(err as Error).message}`);
    }
  }
}

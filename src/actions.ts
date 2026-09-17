import { CommandAction } from '@logitech/plugin-sdk';
import { focusAgent, focusWorkspace, type AgentStatus, type Snapshot } from './herdr';

export const SLOT_COUNT = 9;

export type TileStatus = AgentStatus | 'none';

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
    this.label = this.displayName;
    this.description = description;
  }

  abstract update(snapshot: Snapshot): void;
}

export class SpaceAction extends SlotAction {
  private workspaceId: string | undefined;

  constructor(slot: number) {
    super('Space', slot, `Status of herdr workspace ${slot}; press to focus it`);
  }

  update({ workspaces }: Snapshot) {
    const workspace = workspaces.get(this.slot);
    this.workspaceId = workspace?.workspace_id;
    this.status = workspace?.agent_status ?? 'none';
    this.label = workspace?.label || this.displayName;
  }

  async onKeyDown() {
    if (this.workspaceId) await focusWorkspace(this.workspaceId);
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
    this.label = agent?.terminal_title_stripped || this.displayName;
  }

  async onKeyDown() {
    if (this.paneId) await focusAgent(this.paneId);
  }
}

import { CommandAction } from '@logitech/plugin-sdk';
import { focusWorkspace, type Workspace } from './herdr';

export const SESSION_COUNT = 9;
export const actionNameFor = (n: number) => `herdr_session_${n}`;

export class HerdrSessionAction extends CommandAction {
  readonly name: string;
  displayName: string;
  description: string;
  groupName = 'Herdr';
  workspace: Workspace | undefined;

  constructor(readonly number: number) {
    super();
    this.name = actionNameFor(number);
    this.displayName = `Session ${number}`;
    this.description = `Show status of herdr session ${number}; press to focus it`;
  }

  async onKeyDown() {
    if (!this.workspace) return;
    await focusWorkspace(this.workspace.workspace_id);
  }
}

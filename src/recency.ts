import type { Agent } from './herdr.ts';

// herdr's snapshot carries no activity timestamps, so recency is tracked here:
// a pane moves to the front when its status changes. Merely focusing a pane is
// not activity — tiles would reorder under the press that focused them.
type Entry = { status: string; seq: number };

export class RecencyTracker {
  private seen = new Map<string, Entry>();
  private activitySeq = 0;
  private firstSeenSeq = 0;
  // Panes present in the first snapshot keep their stable workspace order (they
  // get descending sequence numbers); panes appearing later count as activity.
  private bootstrapped = false;

  rank(agents: Agent[]): Agent[] {
    for (const agent of agents) {
      const entry = this.seen.get(agent.pane_id);
      if (!entry) {
        this.seen.set(agent.pane_id, {
          status: agent.agent_status,
          seq: this.bootstrapped ? ++this.activitySeq : --this.firstSeenSeq,
        });
      } else if (entry.status !== agent.agent_status) {
        entry.status = agent.agent_status;
        entry.seq = ++this.activitySeq;
      }
    }
    const live = new Set(agents.map((a) => a.pane_id));
    for (const paneId of [...this.seen.keys()]) if (!live.has(paneId)) this.seen.delete(paneId);
    this.bootstrapped = true;
    return [...agents].sort((a, b) => (this.seen.get(b.pane_id)?.seq ?? 0) - (this.seen.get(a.pane_id)?.seq ?? 0));
  }
}

export const recency = new RecencyTracker();

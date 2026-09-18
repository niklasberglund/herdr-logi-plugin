import type { Agent } from './herdr';

// herdr's snapshot carries no activity timestamps, so recency is tracked here:
// a pane moves to the front when its status changes or when a tile focuses it.
type Entry = { status: string; seq: number };

const seen = new Map<string, Entry>();
let activitySeq = 0;
let firstSeenSeq = 0;
// Panes present in the first snapshot keep their stable workspace order (they
// get descending sequence numbers); panes appearing later count as activity.
let bootstrapped = false;

export function markUsed(paneId: string) {
  const entry = seen.get(paneId);
  if (entry) entry.seq = ++activitySeq;
  else seen.set(paneId, { status: '', seq: ++activitySeq });
}

export function rankByRecency(agents: Agent[]): Agent[] {
  for (const agent of agents) {
    const entry = seen.get(agent.pane_id);
    if (!entry) {
      seen.set(agent.pane_id, { status: agent.agent_status, seq: bootstrapped ? ++activitySeq : --firstSeenSeq });
    } else if (entry.status !== agent.agent_status) {
      entry.status = agent.agent_status;
      entry.seq = ++activitySeq;
    }
  }
  const live = new Set(agents.map((a) => a.pane_id));
  for (const paneId of [...seen.keys()]) if (!live.has(paneId)) seen.delete(paneId);
  bootstrapped = true;
  return [...agents].sort((a, b) => (seen.get(b.pane_id)?.seq ?? 0) - (seen.get(a.pane_id)?.seq ?? 0));
}

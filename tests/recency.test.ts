import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent, AgentStatus } from '../src/herdr.ts';
import { RecencyTracker } from '../src/recency.ts';

function agent(pane_id: string, agent_status: AgentStatus = 'idle'): Agent {
  return { pane_id, workspace_id: pane_id.split(':')[0], agent: 'claude', agent_status, terminal_title_stripped: pane_id };
}

const ids = (agents: Agent[]) => agents.map((a) => a.pane_id);

test('first snapshot keeps workspace order', () => {
  const tracker = new RecencyTracker();
  assert.deepEqual(ids(tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w3:p1')])), ['w1:p1', 'w2:p1', 'w3:p1']);
});

test('a status change moves the pane to the front', () => {
  const tracker = new RecencyTracker();
  tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w3:p1')]);
  const ranked = tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w3:p1', 'working')]);
  assert.deepEqual(ids(ranked), ['w3:p1', 'w1:p1', 'w2:p1']);
});

test('a pane that appears later counts as activity', () => {
  const tracker = new RecencyTracker();
  tracker.rank([agent('w1:p1'), agent('w2:p1')]);
  assert.deepEqual(ids(tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w1:p2')])), ['w1:p2', 'w1:p1', 'w2:p1']);
});

test('repeated snapshots without status changes keep the order', () => {
  const tracker = new RecencyTracker();
  tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w3:p1')]);
  assert.deepEqual(ids(tracker.rank([agent('w1:p1'), agent('w2:p1'), agent('w3:p1')])), ['w1:p1', 'w2:p1', 'w3:p1']);
});

test('a pane that disappears and comes back is treated as new activity', () => {
  const tracker = new RecencyTracker();
  tracker.rank([agent('w1:p1'), agent('w2:p1')]);
  tracker.rank([agent('w2:p1')]);
  assert.deepEqual(ids(tracker.rank([agent('w1:p1'), agent('w2:p1')])), ['w1:p1', 'w2:p1']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentAction, ordinal, RecentAgentAction, SpaceAction } from '../src/actions.ts';
import { EMPTY_SNAPSHOT, type Agent, type Snapshot } from '../src/herdr.ts';
import { labelText } from '../src/status-bridge.ts';

test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 9, 11, 12, 13, 21, 22, 23, 101].map(ordinal), [
    '1st', '2nd', '3rd', '4th', '9th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st',
  ]);
});

test('action names, groups and descriptions', () => {
  const space = new SpaceAction(3);
  assert.equal(space.name, 'herdr_space_3');
  assert.equal(space.displayName, 'Space 3');
  assert.equal(space.groupName, 'Spaces');
  const agent = new AgentAction(2);
  assert.equal(agent.name, 'herdr_agent_2');
  assert.match(agent.description, /2nd running/);
  const recent = new RecentAgentAction(1);
  assert.equal(recent.name, 'herdr_recent_1');
  assert.equal(recent.displayName, 'Recent Agent 1');
  assert.match(recent.description, /1st most recently/);
});

const agents: Agent[] = [
  { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Fix login' },
  { pane_id: 'w2:p1', workspace_id: 'w2', agent: 'codex', agent_status: 'blocked', terminal_title_stripped: '' },
];

const snapshot: Snapshot = {
  focusedWorkspaceId: 'w1',
  workspaces: new Map([[2, { workspace_id: 'w2', active_tab_id: 'w2:t1', number: 2, label: 'api', agent_status: 'blocked' }]]),
  agents,
  recent: [agents[1], agents[0]],
  layouts: new Map(),
};

test('tiles follow the snapshot and clear on an empty one', () => {
  const space1 = new SpaceAction(1);
  const space2 = new SpaceAction(2);
  const agent1 = new AgentAction(1);
  const recent1 = new RecentAgentAction(1);
  const agent3 = new AgentAction(3);
  for (const a of [space1, space2, agent1, recent1, agent3]) a.update(snapshot);
  assert.deepEqual([space1.status, space1.label], ['none', 'Space 1']);
  assert.deepEqual([space2.status, space2.label], ['blocked', 'api']);
  assert.deepEqual([agent1.status, agent1.label], ['working', 'Fix login']);
  assert.deepEqual([recent1.status, recent1.label], ['blocked', 'Recent 1']);
  assert.deepEqual([agent3.status, agent3.label], ['none', 'Agent 3']);
  for (const a of [space2, agent1, recent1]) a.update(EMPTY_SNAPSHOT);
  assert.deepEqual(
    [space2, agent1, recent1].map((a) => [a.status, a.label]),
    [
      ['none', 'Space 2'],
      ['none', 'Agent 1'],
      ['none', 'Recent 1'],
    ],
  );
});

test('a tile with nothing behind it ignores presses', () => {
  const space = new SpaceAction(1);
  space.update(EMPTY_SNAPSHOT);
  assert.equal(space.onKeyDown(), undefined);
  const agent = new AgentAction(5);
  agent.update(snapshot);
  assert.equal(agent.onKeyDown(), undefined);
});

test('labels are blanked, kept or truncated by character', () => {
  assert.equal(labelText(''), '​');
  assert.equal(labelText('short'), 'short');
  assert.equal(labelText('exactly 10'), 'exactly 10');
  assert.equal(labelText('a longer title'), 'a longer …');
  assert.equal(labelText('🐑🐑🐑🐑🐑🐑🐑🐑🐑🐑🐑'), '🐑🐑🐑🐑🐑🐑🐑🐑🐑…');
});

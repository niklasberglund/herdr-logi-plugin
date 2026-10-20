import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentAction, NewTabAction, ordinal, RecentAgentAction, sessionAgentFor, SpaceAction } from '../src/actions.ts';
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
  tabs: new Map(),
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

test('sessionAgentFor prefers the most recent agent of the workspace', () => {
  const a: Agent = { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'x', agent_status: 'idle', terminal_title_stripped: 'a' };
  const b: Agent = { pane_id: 'w1:p2', workspace_id: 'w1', agent: 'x', agent_status: 'idle', terminal_title_stripped: 'b' };
  const c: Agent = { pane_id: 'w2:p1', workspace_id: 'w2', agent: 'x', agent_status: 'idle', terminal_title_stripped: 'c' };
  assert.equal(sessionAgentFor('w1', { agents: [a, b], recent: [b, a] })?.pane_id, 'w1:p2');
  assert.equal(sessionAgentFor('w1', { agents: [a, b], recent: [] })?.pane_id, 'w1:p1');
  assert.equal(sessionAgentFor('w1', { agents: [a, b, c], recent: [c, b] })?.pane_id, 'w1:p2');
  assert.equal(sessionAgentFor('w3', { agents: [a, b, c], recent: [c] }), undefined);
});

test('Space, Agent and Recent keys carry the tab position; New-tab keys and unknown tabs carry none', () => {
  const tabAgents: Agent[] = [
    { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t5', agent: 'x', agent_status: 'idle', terminal_title_stripped: 'a' },
    { pane_id: 'w2:p2', workspace_id: 'w2', agent: 'x', agent_status: 'idle', terminal_title_stripped: 'b' },
  ];
  const snap: Snapshot = {
    ...snapshot,
    workspaces: new Map([[2, { workspace_id: 'w2', active_tab_id: 'w2:t3', number: 2, label: 'api', agent_status: 'idle' }]]),
    agents: tabAgents,
    recent: [tabAgents[1], tabAgents[0]],
    tabs: new Map([['w2:t3', 1], ['w2:t5', 2]]),
  };
  const space = new SpaceAction(2);
  const agent = new AgentAction(1);
  const agentNoTab = new AgentAction(2);
  const recent = new RecentAgentAction(2);
  const newTab = new NewTabAction(2);
  for (const a of [space, agent, agentNoTab, recent, newTab]) a.update(snap);
  assert.equal(space.face.tabNumber, 1, 'active tab of the workspace');
  assert.equal(agent.face.tabNumber, 2, 'agent in a non-first tab');
  assert.equal(recent.face.tabNumber, 2);
  assert.equal(agentNoTab.face.tabNumber, undefined, 'agent without tab_id');
  assert.equal(newTab.face.tabNumber, undefined, 'New-tab key keeps the plain face');
});

test('the face key changes when the active tab changes', () => {
  const space = new SpaceAction(2);
  const withTab = (n: number): Snapshot => ({
    ...snapshot,
    workspaces: new Map([[2, { workspace_id: 'w2', active_tab_id: 'w2:t3', number: 2, label: 'api', agent_status: 'idle' }]]),
    tabs: new Map([['w2:t3', n]]),
  });
  space.update(withTab(1));
  const first = space.faceKey;
  space.update(withTab(2));
  assert.notEqual(space.faceKey, first);
  space.update({ ...withTab(1), tabs: new Map() });
  assert.notEqual(space.faceKey, first, 'unknown tab differs from tab 1');
});

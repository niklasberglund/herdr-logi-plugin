import { PluginSDK } from '@logitech/plugin-sdk';
import { AgentAction, RecentAgentAction, SLOT_COUNT, SpaceAction } from './src/actions';
import { installStatusBridge } from './src/status-bridge';

const pluginSDK = new PluginSDK();

const slots = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1);
const actions = [
  ...slots.map((n) => new SpaceAction(n)),
  ...slots.map((n) => new AgentAction(n)),
  ...slots.map((n) => new RecentAgentAction(n)),
];
for (const action of actions) pluginSDK.registerAction(action);

installStatusBridge(pluginSDK, actions);

await pluginSDK.connect();

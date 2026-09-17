import { PluginSDK } from '@logitech/plugin-sdk';
import { HerdrSessionAction, SESSION_COUNT } from './src/session-actions';
import { installStatusBridge } from './src/status-bridge';

const pluginSDK = new PluginSDK();

const actions = Array.from({ length: SESSION_COUNT }, (_, i) => new HerdrSessionAction(i + 1));
for (const action of actions) pluginSDK.registerAction(action);

installStatusBridge(pluginSDK, actions);

await pluginSDK.connect();

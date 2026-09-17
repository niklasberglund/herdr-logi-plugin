import { PluginSDK } from '@logitech/plugin-sdk';
import { HelloWorldAction } from './src/test-actions';

const pluginSDK = new PluginSDK();

// Register plugin actions
pluginSDK.registerAction(new HelloWorldAction());

await pluginSDK.connect();

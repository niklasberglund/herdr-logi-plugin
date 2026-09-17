import type { PluginSDK } from '@logitech/plugin-sdk';
import { getWorkspaces, type AgentStatus } from './herdr';
import { circlePng, type Rgb } from './png';
import { HerdrSessionAction } from './session-actions';

const POLL_MS = 1000;
const IMAGE_SIZE = 80;
const MAX_LABEL_CHARS = 10;

const STYLE: Record<AgentStatus | 'none', { rgb: Rgb; filled: boolean }> = {
  blocked: { rgb: [230, 40, 40], filled: true },
  working: { rgb: [240, 180, 0], filled: true },
  done: { rgb: [0, 200, 80], filled: true },
  idle: { rgb: [0, 200, 80], filled: false },
  unknown: { rgb: [150, 150, 150], filled: false },
  none: { rgb: [70, 70, 70], filled: false },
};

const imageCache = new Map<string, string>();
function imageFor(status: AgentStatus | 'none'): string {
  let cached = imageCache.get(status);
  if (!cached) {
    const { rgb, filled } = STYLE[status];
    cached = circlePng(IMAGE_SIZE, rgb, filled).toString('base64');
    imageCache.set(status, cached);
  }
  return cached;
}

function truncate(text: string): string {
  return text.length > MAX_LABEL_CHARS ? text.slice(0, MAX_LABEL_CHARS - 1) + '…' : text;
}

function labelFor(action: HerdrSessionAction): string {
  return truncate(action.workspace?.label || `Session ${action.number}`);
}

// The SDK's GetActionImage handler always answers null and it has no hook for
// runtime image/text updates, so we answer those requests ourselves on its
// WebSocket client and push ActionImageChanged/ActionTextChanged events, which
// the Plugin Service honours the same way it does for C# plugins.
export function installStatusBridge(sdk: PluginSDK, actions: HerdrSessionAction[]) {
  const internals = sdk as unknown as {
    _client: { onMessage(h: (data: Buffer) => void): void; sendMessage(m: unknown): void };
    _handleMessage(data: Buffer): Promise<void>;
  };
  const client = internals._client;
  const fallback = internals._handleMessage.bind(sdk);
  const byName = new Map(actions.map((a) => [a.name, a]));

  client.onMessage((data) => {
    const msg = JSON.parse(data.toString('utf8'));
    const action = msg.messageType === 'Request' ? byName.get(msg.parameters?.actionName) : undefined;
    if (action && msg.name === 'GetActionImage') {
      const status = action.workspace?.agent_status ?? 'none';
      reply(msg.id, msg.name, { image: imageFor(status) });
      return;
    }
    if (action && msg.name === 'GetActionText') {
      reply(msg.id, msg.name, { text: labelFor(action) });
      return;
    }
    fallback(data);
  });

  function reply(id: number, name: string, data: unknown) {
    client.sendMessage({ id, name, messageType: 'Response', data, failed: false, errorMessage: '', errorCode: 0 });
  }

  function notify(name: 'ActionImageChanged' | 'ActionTextChanged', actionName: string) {
    client.sendMessage({
      id: 0,
      name,
      messageType: 'Event',
      parameters: { pluginName: process.env.LPS_PLUGIN_NAME, actionName, actionParameter: null },
    });
  }

  async function poll() {
    let workspaces: Awaited<ReturnType<typeof getWorkspaces>>;
    try {
      workspaces = await getWorkspaces();
    } catch {
      workspaces = new Map();
    }
    for (const action of actions) {
      const prev = action.workspace;
      const next = workspaces.get(action.number);
      action.workspace = next;
      if (prev?.agent_status !== next?.agent_status) notify('ActionImageChanged', action.name);
      if (prev?.label !== next?.label) notify('ActionTextChanged', action.name);
    }
  }

  setInterval(poll, POLL_MS);
}

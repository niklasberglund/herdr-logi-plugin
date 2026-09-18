import type { PluginSDK } from '@logitech/plugin-sdk';
import { getSnapshot, type Snapshot } from './herdr';
import { circlePng, type CircleStyle, type Rgb } from './png';
import type { SlotAction, TileStatus } from './actions';

const POLL_MS = 1000;
const IMAGE_SIZE = 80;
const MAX_LABEL_CHARS = 10;

const STYLE: Record<TileStatus, { rgb: Rgb; style: CircleStyle }> = {
  blocked: { rgb: [230, 40, 40], style: 'filled' },
  working: { rgb: [240, 180, 0], style: 'filled' },
  done: { rgb: [0, 200, 80], style: 'filled' },
  idle: { rgb: [0, 120, 48], style: 'outline' },
  unknown: { rgb: [150, 150, 150], style: 'outline' },
  none: { rgb: [70, 70, 70], style: 'dotted' },
};

const imageCache = new Map<TileStatus, string>();
function imageFor(status: TileStatus): string {
  let cached = imageCache.get(status);
  if (!cached) {
    const { rgb, style } = STYLE[status];
    cached = circlePng(IMAGE_SIZE, rgb, style).toString('base64');
    imageCache.set(status, cached);
  }
  return cached;
}

// The Plugin Service falls back to the action's display name when the text is
// empty or whitespace, so an unused slot answers with a zero-width space.
const BLANK = '\u200B';

function labelText(text: string): string {
  if (!text) return BLANK;
  return text.length > MAX_LABEL_CHARS ? text.slice(0, MAX_LABEL_CHARS - 1) + '…' : text;
}

// The SDK's GetActionImage handler always answers null and it has no hook for
// runtime image/text updates, so we answer those requests ourselves on its
// WebSocket client and push ActionImageChanged/ActionTextChanged events, which
// the Plugin Service honours the same way it does for C# plugins.
export function installStatusBridge(sdk: PluginSDK, actions: SlotAction[]) {
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
      reply(msg.id, msg.name, { image: imageFor(action.status) });
      return;
    }
    if (action && msg.name === 'GetActionText') {
      reply(msg.id, msg.name, { text: labelText(action.label) });
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
    let snapshot: Snapshot;
    try {
      snapshot = await getSnapshot();
    } catch {
      snapshot = { focusedWorkspaceId: undefined, workspaces: new Map(), agents: [], layouts: new Map() };
    }
    for (const action of actions) {
      const { status, label } = action;
      action.update(snapshot);
      if (status !== action.status) notify('ActionImageChanged', action.name);
      if (label !== action.label) notify('ActionTextChanged', action.name);
    }
  }

  setInterval(poll, POLL_MS);
}

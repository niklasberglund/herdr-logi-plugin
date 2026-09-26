import type { PluginSDK } from '@logitech/plugin-sdk';
import { EMPTY_SNAPSHOT, getSnapshot, type Snapshot } from './herdr.ts';
import { circlePng, type CircleStyle, type Rgb } from './png.ts';
import type { SlotAction, TileStatus } from './actions.ts';

const POLL_MS = 1000;
export const IMAGE_SIZE = 80;
const MAX_LABEL_CHARS = 10;

const STYLE: Record<TileStatus, { rgb: Rgb; style: CircleStyle }> = {
  blocked: { rgb: [230, 40, 40], style: 'filled' },
  working: { rgb: [240, 180, 0], style: 'filled' },
  done: { rgb: [0, 200, 80], style: 'filled' },
  idle: { rgb: [0, 120, 48], style: 'outline' },
  unknown: { rgb: [150, 150, 150], style: 'outline' },
  none: { rgb: [70, 70, 70], style: 'dotted' },
  offline: { rgb: [140, 50, 50], style: 'dotted' },
};

// A status herdr gained after this plugin was written reaches us as a string
// outside TileStatus, so it falls back to the `unknown` tile instead of
// throwing. Each new name is reported once.
const warnedStatuses = new Set<string>();
export function styleFor(status: TileStatus) {
  const style = STYLE[status];
  if (style) return style;
  if (!warnedStatuses.has(status)) {
    warnedStatuses.add(status);
    console.warn(`herdr reported agent status '${status}', which this plugin does not know; showing it as unknown`);
  }
  return STYLE.unknown;
}

const imageCache = new Map<TileStatus, string>();
export function imageFor(status: TileStatus): string {
  let cached = imageCache.get(status);
  if (!cached) {
    const { rgb, style } = styleFor(status);
    cached = circlePng(IMAGE_SIZE, rgb, style).toString('base64');
    imageCache.set(status, cached);
  }
  return cached;
}

// The Plugin Service falls back to the action's display name when the text is
// empty or whitespace, so an unused slot answers with a zero-width space.
const BLANK = '​';

export function labelText(text: string): string {
  if (!text) return BLANK;
  const chars = Array.from(text);
  return chars.length > MAX_LABEL_CHARS ? chars.slice(0, MAX_LABEL_CHARS - 1).join('') + '…' : text;
}

type Client = { onMessage(handler: (data: Buffer) => void): void; sendMessage(message: unknown): void };
type Internals = { _client?: Partial<Client>; _handleMessage?(data: Buffer): Promise<void> };

// The SDK's GetActionImage handler always answers null and it has no hook for
// runtime image/text updates, so we answer those requests ourselves on its
// WebSocket client and push ActionImageChanged/ActionTextChanged events, which
// the Plugin Service honours the same way it does for C# plugins.
// See docs/dynamic-tile-images.md.
export function installStatusBridge(sdk: PluginSDK, actions: SlotAction[]) {
  // Without this the Plugin Service drops every update event, so tiles keep
  // their first face for the whole session with nothing else going wrong.
  if (!process.env.LPS_PLUGIN_NAME) {
    console.error(
      'LPS_PLUGIN_NAME is not set; the Plugin Service ignores image and text update events without it, so tiles will not refresh.',
    );
  }
  const notify = hookMessages(sdk as unknown as Internals, actions);
  startPolling(actions, notify);
}

type Notify = (name: 'ActionImageChanged' | 'ActionTextChanged', actionName: string) => void;

export function hookMessages(internals: Internals, actions: SlotAction[]): Notify {
  const client = internals._client;
  if (
    typeof client?.onMessage !== 'function' ||
    typeof client.sendMessage !== 'function' ||
    typeof internals._handleMessage !== 'function'
  ) {
    console.error(
      'Logi Plugin SDK internals have changed; live tile images are disabled. Pin @logitech/plugin-sdk to 0.1.1.',
    );
    return () => {};
  }
  const send = client.sendMessage.bind(client);
  const fallback = internals._handleMessage.bind(internals);
  const byName = new Map(actions.map((a) => [a.name, a]));

  client.onMessage((data) => {
    let msg: { id: number; name: string; messageType: string; parameters?: { actionName?: string } };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return void fallback(data);
    }
    const action = msg.messageType === 'Request' ? byName.get(msg.parameters?.actionName ?? '') : undefined;
    if (action && msg.name === 'GetActionImage') {
      reply(msg.id, msg.name, { image: imageFor(action.status) });
      return;
    }
    if (action && msg.name === 'GetActionText') {
      reply(msg.id, msg.name, { text: labelText(action.label) });
      return;
    }
    void fallback(data);
  });

  function reply(id: number, name: string, data: unknown) {
    send({ id, name, messageType: 'Response', data, failed: false, errorMessage: '', errorCode: 0 });
  }

  return (name, actionName) => {
    send({
      id: 0,
      name,
      messageType: 'Event',
      parameters: { pluginName: process.env.LPS_PLUGIN_NAME, actionName, actionParameter: null },
    });
  };
}

// An action whose snapshot cannot be applied is left showing what it showed
// before. Each failure is reported once per action, because the poll runs every
// second and would otherwise fill the log with the same line.
const warnedActions = new Set<string>();

// Never throws. A single bad action must not stop the remaining slots from
// updating, nor take down the poll loop that schedules the next run.
export function applySnapshot(actions: SlotAction[], snapshot: Snapshot | undefined, notify: Notify) {
  for (const action of actions) {
    try {
      const { status, label } = action;
      action.update(snapshot ?? EMPTY_SNAPSHOT);
      if (!snapshot) {
        action.status = 'offline';
        action.label = 'offline';
      }
      if (status !== action.status) notify('ActionImageChanged', action.name);
      if (label !== action.label) notify('ActionTextChanged', action.name);
    } catch (error) {
      if (!warnedActions.has(action.name)) {
        warnedActions.add(action.name);
        console.error(
          `tile '${action.name}' could not be updated and keeps its last state: ${(error as Error).message}`,
        );
      }
    }
  }
}

// Each poll schedules the next one only after it has finished, so a slow herdr
// never produces overlapping polls that could apply snapshots out of order.
//
// This keeps running even when hookMessages found no client to hook: `update()`
// is also what gives each action the workspace or pane its `onKeyDown` focuses,
// so without it the keys would go stale as well as static.
function startPolling(actions: SlotAction[], notify: Notify) {
  let online = true;
  let first = true;

  async function poll() {
    let snapshot: Snapshot | undefined;
    try {
      snapshot = await getSnapshot();
      if (!online) console.info('herdr is reachable again');
      online = true;
    } catch (error) {
      if (online) console.warn(`herdr is unreachable, tiles show offline: ${(error as Error).message}`);
      online = false;
    }
    try {
      applySnapshot(actions, snapshot, notify);
      // The service keeps faces from an earlier run (or an earlier install) and
      // only asks again when told, so a tile whose state matches its initial
      // one would never be refreshed.
      if (first) {
        first = false;
        for (const action of actions) {
          notify('ActionImageChanged', action.name);
          notify('ActionTextChanged', action.name);
        }
      }
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  void poll();
}

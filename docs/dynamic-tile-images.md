# Live tile images from a Node.js plugin

The public Node.js SDK (`@logitech/plugin-sdk` 0.1.1) exposes `onKeyDown()` and
static icons only. Several projects concluded that live key faces need the C#
SDK. They do not: the Logi Plugin Service speaks the same protocol to Node
plugins, and the SDK simply does not wire the relevant messages. This plugin
answers them itself in `src/status-bridge.ts`.

## What the service does

- The service sends a `GetActionImage` request (`{ pluginName, actionName,
  actionParameter }`) whenever it needs a key face. The SDK's built-in handler
  always replies `data: null`; its source map shows the intended reply type is
  `{ image: string }`.
- The service sends a `GetActionText` request the same way. The SDK enum lists
  it but nothing handles it.
- A plugin can push an `ActionImageChanged` or `ActionTextChanged` event with
  the same parameters. The service then re-requests the image or text at once.
  This mirrors `ActionImageChanged()` in the C# SDK.

## The workaround

1. Reach the SDK's WebSocket client through its private `_client` field and
   register a handler with `client.onMessage(...)`. Overriding `_handleMessage`
   on the instance does not work, because the SDK binds its own handler in the
   constructor.
2. For a `GetActionImage` request aimed at one of our actions, reply with
   `{ id, name, messageType: 'Response', data: { image: <base64 PNG> }, failed:
   false, errorMessage: '', errorCode: 0 }`. An 80x80 RGBA PNG renders cleanly
   on the MX Creative Keypad. Reply to `GetActionText` with `{ text }`.
3. Pass every other message to the SDK's original `_handleMessage`.
4. When a tile's state changes, send an `ActionImageChanged` or
   `ActionTextChanged` event: `{ id: 0, name, messageType: 'Event', parameters:
   { pluginName: process.env.LPS_PLUGIN_NAME, actionName, actionParameter: null } }`.

Two details matter in practice:

- An empty or whitespace text makes the service fall back to the action's
  display name. A zero-width space (`​`) gives a genuinely blank label.
- Image data is cached per status and encoded once. The PNG encoder in
  `src/png.ts` needs nothing beyond `zlib`.

## Risk

This depends on private SDK internals (`_client`, `_handleMessage`). The SDK
version is pinned exactly, the bridge checks that those members exist before
hooking in, and it degrades to static icons with a logged error if they are
missing. Re-verify on every SDK upgrade.

Logitech has not published a roadmap for the Node SDK. As of September 2026
there is no newer release than 0.1.1, no public source repository, and issues
are disabled on the example repository.

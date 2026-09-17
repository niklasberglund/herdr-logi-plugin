# Herdr session control plugin — plan

## Goal
Add controls for herdr sessions 1-9 to the Logi Actions device:
- Each button shows the session's live status as a colored circle (matching herdr's own indicators): unfilled green for idle, red for needing feedback (blocked), etc.
- Clicking a button brings the terminal window to the front and tells herdr to focus that session.

## Status of dynamic button images (investigated 2026-09-17)

**Not exposed by the public Node SDK, but fully supported by the Plugin Service — verified working.**

- `@logitech/plugin-sdk` v0.1.1 (latest, published 2025-11-03; toolkit 0.1.1 from 2025-12-15). No newer release, no public source repo, GitHub issues disabled on `Logitech/actions-sdk`, no roadmap or changelog published. Nothing to follow for an official fix beyond the Logitech developer Discord.
- The C# SDK has had this for years (`PluginDynamicCommand.GetCommandImage` + `ActionImageChanged()`), and the Plugin Service speaks the same protocol to Node plugins:
  - The service sends `GetActionImage` requests (`{pluginName, actionName, actionParameter}`) to the Node plugin. The SDK's handler is a stub that always replies `data: null` (the source map shows the intended reply type is `{ image: string }`).
  - The plugin can push an `ActionImageChanged` event; the service then immediately re-requests `GetActionImage`. `ActionTextChanged` exists in the SDK's enum too but is unwired.
- Workaround, proven on the MX Creative Keypad: register a handler on the SDK's WebSocket client (`(sdk as any)._client.onMessage(...)`), answer `GetActionImage` with `{ image: <base64 PNG> }` (80x80 RGBA works), and push `ActionImageChanged` whenever status changes. See `src/experiment.ts`. Note: the SDK binds its own handler in the constructor, so overriding `_handleMessage` on the instance does not work; `client.onMessage()` does.
- Risk: relies on private SDK internals (`_client`, `_handleMessage`). Pin the SDK version and re-verify on upgrade.

Other plugins doing live session tiles all use C#: `pffan91/claudewarp-keypad-mx` (Claude Code sessions in Warp — nearly identical concept), `rshankras/claude-console` (Claude Code in Terminal.app). `digitarald/mx-keypad-ahp-bridge` bypasses Options+ entirely over raw HID.

## Herdr side (confirmed)
- `herdr api snapshot` — JSON snapshot of all workspaces including `agent_status` per workspace: `idle`, `working`, `blocked`, `done`, `unknown`.
  - Mapping: `blocked` → red filled (needs feedback), `working` → amber filled, `idle`/`done` → green, `unknown` → gray.
- `herdr workspace focus <workspace_id>` — switches herdr's focus. Workspace `number` (1-9) is what the user calls "session N"; resolve `workspace_id` by matching `number` in the snapshot.
- herdr's client runs inside iTerm2: `osascript -e 'tell application "iTerm" to activate'`.
- Both can be shelled out to from the plugin process (`child_process.exec`), same pattern as `src/test-actions.ts`.

## Implementation sketch
1. Register 9 `CommandAction`s (`herdr_session_1` .. `herdr_session_9`).
2. Poll `herdr api snapshot` (~1 s) or use its socket subscription events; keep status per workspace number; on change, push `ActionImageChanged` for that action.
3. Answer `GetActionImage` per action with a PNG circle for the current status (generator in `src/experiment.ts`), plus the session number/label if useful.
4. `onKeyDown()` for session N: activate iTerm, then `herdr workspace focus <workspace_id>`.
5. No workspace with that number → gray/empty tile, no-op on press.

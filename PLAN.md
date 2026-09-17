# Herdr session control plugin — plan

## Goal
Add controls for herdr sessions 1-9 to the Logi Actions device:
- Each button shows the session's live status as a colored circle (matching herdr's own indicators): unfilled green for idle, red for needing feedback (blocked), etc.
- Clicking a button brings the terminal window to the front and tells herdr to focus that session.

## Blocked on
The Logi Actions Node.js SDK (`@logitech/plugin-sdk`, currently v0.1.1, latest published version as of 2026-09-17) does not support updating a button's icon/image at runtime.

`CommandAction` only supports a static icon assigned at build time via SVG files in `package/actionicons/` and `package/actionsymbols/`. Inspection of the compiled SDK (`node_modules/@logitech/plugin-sdk/dist/index.js`) shows the protocol has a `GetActionImage` request/response message, but the SDK's handler (`GetActionImageRequestHandler`) is hardcoded to return `null` with no override hook exposed to plugin authors. There is also an `ActionTextChanged` message name defined in the protocol enum but not wired into any usable request/response class.

**We are waiting for the SDK to expose a way to push icon (and/or text) updates for a registered action at runtime**, e.g. something like `action.setImage(...)` or a `getImage()` override hook plugin authors can implement.

Check `npm view @logitech/plugin-sdk versions` periodically for new releases, and re-check `dist/index.d.ts` for a runtime image/text update API when one ships.

## What's already confirmed working (herdr side)
- `herdr api snapshot` — JSON snapshot of all workspaces including `agent_status` per workspace: `idle`, `working`, `blocked`, `done`, `unknown`.
  - Suggested mapping: `blocked` → red (needs feedback), `idle`/`done` → green, `working` → in-progress color, `unknown` → gray.
- `herdr workspace focus <workspace_id>` — switches herdr's focus to a given workspace. Workspace `number` field (1-9, etc.) maps to what the user calls "session N"; resolve `workspace_id` by matching `number` in the snapshot.
- herdr's client currently runs inside iTerm2 on this machine. Bringing the terminal window forward: `osascript -e 'tell application "iTerm" to activate'`.
- Both of the above can be shelled out to directly from the Node.js plugin process (`child_process.exec`), no additional auth needed — same pattern as the scaffolded `HelloWorldAction` in `src/test-actions.ts`.

## Implementation sketch (once unblocked)
1. Register 9 `CommandAction` subclasses, one per session (`herdr_session_1` .. `herdr_session_9`).
2. On some interval or on-demand hook, call `herdr api snapshot`, find the workspace with matching `number`, read `agent_status`, and push an icon update reflecting it (mechanism TBD — this is the blocked part).
3. `onKeyDown()` for session N:
   - `osascript -e 'tell application "iTerm" to activate'`
   - `herdr workspace focus <workspace_id for session N>`
4. Handle the case where no workspace with that number currently exists (button should probably show an "empty/inactive" state and no-op on click, or create a new workspace).

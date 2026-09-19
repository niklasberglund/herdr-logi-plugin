# Herdr for Logi Actions

**Live status of your [herdr](https://herdr.dev) workspaces and coding agents on the
Logitech MX Creative Keypad. Press a key to jump to one.**

herdr runs your AI coding agents (Claude Code, Codex, OpenCode and others) in
managed terminal panes and exposes their state over a local socket. This
plugin puts that state on the keypad's nine LCD keys: each key is a coloured
ring for one workspace or agent, its label underneath, updated live. Pressing
a key brings your terminal to the front and focuses that workspace or pane in
herdr.

<p align="center">
  <img src="docs/images/keypad.png" width="420"
   alt="The keypad: fix-login waiting on you, refactor-auth and add-tests
   working, migrate-db finished, review-pr idle, and three empty slots">
</p>

*The rings are the plugin's own key images, drawn by the code that answers the
keypad, over a demo herdr session. `npm run deck -- --live` redraws them from
whatever herdr is running right now.*

It is a [Logi Actions SDK](https://logitech.github.io/actions-sdk-docs/)
plugin written in TypeScript. Unlike other Node plugins it draws its key faces
at runtime; see [docs/dynamic-tile-images.md](docs/dynamic-tile-images.md) for
how.

## Tiles

Three groups of nine actions appear under **Herdr** in Logi Options+. Drag any
of them onto keys.

| Group | Key | Shows | Press |
|---|---|---|---|
| Herdr Spaces | Space 1 to 9 | Workspace with that number: its label and combined agent status | Focuses the workspace. Pressing again cycles through the panes of its active tab. |
| Herdr Agents | Agent 1 to 9 | The Nth running agent, in workspace order: its terminal title and status | Focuses that agent's pane. |
| Herdr Recent Agents | Recent Agent 1 to 9 | The same agents ordered by most recent activity, so a few keys cover a session running more agents than there are keys | Focuses that agent's pane. |

Ring colours match herdr's own status indicators:

<img src="docs/images/tile-states.png" width="600"
 alt="The seven tile states, left to right: blocked, working, done, idle,
 unknown, empty and offline">

| Ring | Status |
|---|---|
| Red, filled | **blocked**: the agent is waiting for you |
| Amber, filled | **working** |
| Green, filled | **done**: the turn finished |
| Green, outline | **idle** |
| Grey, outline | **unknown** |
| Dark grey, dotted | nothing in this slot |
| Dark red, dotted | herdr is not running or cannot be reached |

An agent becomes "recently active" when its status changes or when you focus it
from a key. Agents already running when the plugin starts keep their workspace
order until something happens to them.

## Requirements

| Requirement | Details |
|---|---|
| macOS | The plugin raises your terminal with `open -a`. Linux and Windows are not supported. |
| herdr | 0.8.2 or newer, running locally. The plugin talks to `~/.config/herdr/herdr.sock` and was tested against socket protocol 20. |
| Logi Options+ | With the Logi Plugin Service 6.1 or newer, which ships with Options+. |
| Device | Logitech MX Creative Keypad. Other Logi Actions devices with key displays may work but are untested. |
| Node.js 22.18+ | Only to build from source. |

## Install

### From a release

1. Download `Herdr_<version>.lplug4` from the
   [latest release](https://github.com/niklasberglund/herdr-logi-actions/releases/latest).
2. Double-click it. Logi Options+ installs the plugin.
3. In Options+, select the MX Creative Keypad, open **All actions**, and drag
   **Herdr** actions onto keys.

### From source

```sh
git clone https://github.com/niklasberglund/herdr-logi-actions.git
cd herdr-logi-actions
npm install
npm run build
npm run link
```

`npm run link` symlinks the built plugin into the Plugin Service and asks it to
reload. `npm run watch` rebuilds and reloads on every change. `npm run unlink`
removes the link again. Do not keep a dev link and an installed package at the
same time.

## Configuration

Pressing a key first brings your terminal application to the front, then asks
herdr to change focus. The terminal is detected automatically, in this order:

1. The app hosting the running herdr client, found by walking up the process
   tree. This works for any macOS terminal. If herdr is attached in more than
   one terminal, the most recently started client wins.
2. Otherwise a known terminal that is currently running, preferring iTerm,
   Ghostty, WezTerm, kitty, Warp, Alacritty, Rio, Hyper, Tabby, then Terminal.
3. Otherwise the first of those that is installed. Terminal ships with macOS,
   so this step always finds something.

The result is cached for 30 seconds.

To override the detection, create `~/.config/herdr-logi-actions/config.json`:

```json
{ "terminalApp": "Ghostty" }
```

The value is an application name or `.app` path as accepted by `open -a`. An
empty string disables the activation step. The file is read on every press, so
edits apply immediately.

Environment variables for development: `HERDR_SOCKET_PATH` overrides the
socket, `HERDR_LOGI_CONFIG` overrides the config file path.

## How it works

```
MX Creative Keypad ── Logi Plugin Service ──WebSocket── this plugin (Node.js)
                                                            │ every second:
                                                            │   session.snapshot
                                                            │ on press:
                                                            │   workspace.focus / pane.focus
                                                            ▼
                                                    ~/.config/herdr/herdr.sock
```

- The plugin polls herdr's `session.snapshot` once a second and pushes an
  `ActionImageChanged` or `ActionTextChanged` event to the Plugin Service for
  each key whose status or label changed. The service then asks for the new
  image, which the plugin renders as an 80x80 PNG with no image library.
- Presses are queued so rapid taps see the focus state left by the previous
  one. A Space key press fetches a fresh snapshot to decide between focusing
  the workspace and cycling its panes.
- Everything runs on your machine. The plugin has no network code: it opens the
  local herdr socket, reads the process table and runs `open -a` to raise your
  terminal, and nothing else. It collects no data and never edits herdr's or any agent's
  configuration.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Every key shows a dark red dotted ring | herdr is not running, or the socket is somewhere else. `herdr status` should report a running server and the socket path. |
| Keys stay on the dotted grey ring | The slot has nothing to show: no workspace with that number, or fewer agents than that. |
| A press raises the wrong terminal | Detection fell through to a running or installed terminal, for example when herdr is attached over SSH from another machine. Set `terminalApp` as described under Configuration. |
| Actions do not appear in Options+ after `npm run link` | Look at the log, then restart the Plugin Service from Options+ settings. |
| Keys show plain text or a static icon after building from source | A dev link and an installed package are both registered. Keep one. |

The plugin log is at
`~/Library/Application Support/Logi/LogiPluginService/Logs/plugin_logs/Herdr.log`.

## Development

```sh
npm run check        # typecheck, version consistency, tests
npm test             # unit tests (node --test, no extra tooling)
npm run build:pack   # production build and Herdr.lplug4 for distribution
npm run icon         # regenerate package/metadata/Icon256x256.png
npm run deck         # regenerate the README key images in docs/images
```

`npm run deck` draws the README pictures with the plugin's own ring renderer,
so they cannot drift from the key faces the device gets. The nine faces go
behind `assets/keypad-frame.png`, a rendering of the keypad whose key windows
are transparent, so its bezels and their gloss fall over them. The windows are
found in that image's alpha channel rather than written down anywhere, so
replacing the frame is enough to move the faces with it. Add `-- --live`
to draw the herdr session running right now instead of the demo one. It needs
an SVG rasteriser — `brew install librsvg` — and writes the SVG instead of the
PNG if none is installed.

Layout:

```
index.ts                 registers the 27 actions and connects to the Plugin Service
src/actions.ts           Space, Agent and Recent Agent actions and the press queue
src/herdr.ts             herdr socket client, snapshot shaping, terminal activation
src/recency.ts           most-recently-active ordering for the Recent Agent keys
src/status-bridge.ts     answers GetActionImage/GetActionText and pushes change events
src/png.ts               dependency-free PNG ring renderer
package/                 plugin manifest, icon, per-action icons
assets/                  keypad frame the README pictures are drawn into
scripts/                 icon generator, README key-image renderer, version check
tests/                   unit tests
docs/                    how live key faces work from a Node plugin, README images
```

Releases: bump the version in `package.json` and
`package/metadata/LoupedeckPackage.yaml`, update `CHANGELOG.md`, and push a
`vX.Y.Z` tag. The release workflow builds the package and attaches
`Herdr_X.Y.Z.lplug4` to a GitHub Release.

## License

[MIT](LICENSE). The package bundles
[@logitech/plugin-sdk](https://www.npmjs.com/package/@logitech/plugin-sdk) and
[ws](https://github.com/websockets/ws), both MIT licensed.

Logitech, Logi, MX Creative Console and MX Creative Keypad are trademarks of
Logitech International S.A. This is an independent community project and is
not affiliated with or endorsed by Logitech or the herdr project.

# Contributing

## Build from source

Needs Node.js 22.18 or newer.

```sh
git clone https://github.com/niklasberglund/herdr-logi-plugin.git
cd herdr-logi-plugin
npm install
npm run build
npm run link
```

`npm run link` symlinks the built plugin into the Logi Plugin Service and asks
it to reload. `npm run watch` rebuilds and reloads on every change.
`npm run unlink` removes the link. Do not keep a dev link and an installed
package at the same time: the keys then show plain text or a static icon.

## Commands

```sh
npm run check        # typecheck, version consistency, tests
npm test             # unit tests (node --test, no extra tooling)
npm run build:pack   # production build and Herdr.lplug4 for distribution
npm run icon         # regenerate package/metadata/Icon256x256.png
npm run deck         # regenerate the README key images in docs/images
```

Environment variables: `HERDR_SOCKET_PATH` overrides the herdr socket,
`HERDR_LOGI_CONFIG` overrides the config file path.

## How it works

```
MX Keypad ─────────── Logi Plugin Service ──WebSocket── this plugin (Node.js)
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
  The public Node SDK does not support this; see
  [docs/dynamic-tile-images.md](docs/dynamic-tile-images.md).
- Presses are queued so rapid taps see the focus state left by the previous
  one. A Space key press fetches a fresh snapshot to decide between focusing
  the workspace and cycling its panes.
- Recent Agent order changes only when an agent's status changes, never on
  focus, so keys do not reorder under the press that focused them. Agents
  already running when the plugin starts keep their workspace order.
- The terminal to raise is found by walking up the process tree from the
  herdr client to its `.app` bundle, then falling back to a known terminal
  that is running, then to one that is installed. The result is cached for
  30 seconds.

## Layout

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

## README images

`npm run deck` draws the README pictures with the plugin's own ring renderer,
so they cannot drift from the key faces the device gets. The faces go behind
`assets/keypad-frame.png`, whose key windows are transparent; the windows are
found in its alpha channel, so replacing the frame moves the faces with it.
`npm run deck -- --live` draws the herdr session running right now instead of
the demo one. It needs an SVG rasteriser (`brew install librsvg`) and writes
the SVG instead of the PNG if none is installed.

## Releases

See [RELEASE.md](RELEASE.md). In short: bump the version in `package.json` and
`package/metadata/LoupedeckPackage.yaml`, update `CHANGELOG.md`, and push a
`vX.Y.Z` tag. The release workflow attaches `Herdr_X.Y.Z.lplug4` to a GitHub
Release.

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Tabs tiles (`New 1` to `New 9`): one press opens a new shell tab in the
  matching herdr workspace and focuses it. Shown with a purple "tab + plus"
  icon (not a status ring, so it can't be mistaken for an agent indicator)
  and labelled with the workspace name alone.

## [0.2.0] - 2026-10-22

### Added

- Loupedeck CT family support (`LoupedeckCtFamily`): Loupedeck CT, Live and
  Live S, and the Razer Stream Controller. Only tested on the Live S so far.

### Changed

- Rewritten in C# on Logitech's .NET plugin SDK; the plugin no longer runs on
  Node.js. Keys, rings, labels and configuration behave as before.
- Requires Logi Plugin Service 6.4 or newer.

## [0.1.2] - 2026-09-26

### Changed

- Empty tiles show their slot name ("Agent 3", "Space 3", "Recent 3") and
  tiles show "offline" while herdr is unreachable, instead of a blank label
  that left the ring looking too high on the key.

## [0.1.1] - 2026-09-23

### Changed

- Declare the MX Keypad (`MxCreativeKeypad`) as the supported device.

## [0.1.0] - 2026-09-23

### Added

- Space 1 to 9 tiles: live status of herdr workspaces by number; press to focus,
  press again to cycle the workspace's panes.
- Agent 1 to 9 tiles: live status of running agents in workspace order; press to
  focus the agent's pane.
- Recent Agent 1 to 9 tiles: the same agents ordered by most recent activity.
- Live tile images and labels from a Node.js plugin, answering the Plugin
  Service's `GetActionImage` and `GetActionText` requests directly.
- Automatic detection of the terminal application hosting the herdr client, so
  a press raises Terminal, iTerm, Ghostty, WezTerm, kitty, Warp, Alacritty or
  any other macOS terminal without configuration. Falls back to a known
  terminal that is running, then to one that is installed.
- `~/.config/herdr-logi-plugin/config.json` with `terminalApp` to override
  the detected terminal or disable the activation step.

[Unreleased]: https://github.com/niklasberglund/herdr-logi-plugin/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/niklasberglund/herdr-logi-plugin/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/niklasberglund/herdr-logi-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/niklasberglund/herdr-logi-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/niklasberglund/herdr-logi-plugin/releases/tag/v0.1.0

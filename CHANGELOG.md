# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/niklasberglund/herdr-logi-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/niklasberglund/herdr-logi-plugin/releases/tag/v0.1.0

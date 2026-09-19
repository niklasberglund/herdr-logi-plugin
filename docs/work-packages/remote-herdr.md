# Work package: remote herdr sessions

Status: proposed, not scheduled. Not part of 0.1.0.

## Problem

The plugin reads one socket, `~/.config/herdr/herdr.sock`, so it only shows
workspaces and agents owned by the local herdr server. herdr's remote modes
keep session state on the remote host:

- `herdr --remote <host>` runs the server remotely and streams the UI over
  SSH. The local client draws the UI but does not publish that session on a
  local socket.
- SSH into the host and run `herdr` there: everything lives on the host.

In both cases the keypad shows the local server's state, usually nothing.

## What makes it feasible

- herdr's JSON socket API is the same locally and remotely, and client and
  server builds do not need to match ("Protocol stability" in the socket API
  docs).
- A Unix socket can be forwarded over SSH:
  `ssh -N -L ~/.config/herdr/<host>.sock:.config/herdr/herdr.sock <host>`.
- HerdDeck (nickboy/herddeck), the Stream Deck equivalent, works this way: a
  daemon forwards each remote `herdr.sock` over SSH and pings through the
  tunnel rather than trusting the socket file's existence.
- Terminal activation keeps working. The local `herdr --remote` client is a
  local process inside a local terminal, which is what the process-tree
  detection in `src/herdr.ts` finds. Focus requests go to the remote server
  over the forwarded socket, which is the desired behaviour.

## Tier 1: manual tunnel, configurable socket

Small. Lets a user who runs their own SSH tunnel point the plugin at it.

- Add `socketPath` to `~/.config/herdr-logi-actions/config.json`. Absent means
  the default local socket. `HERDR_SOCKET_PATH` remains a development
  override.
- `src/herdr.ts` currently fixes `SOCKET_PATH` at module load. Resolve it per
  request instead, reading the config the same way `terminalApp` is read, so
  edits apply without a plugin reload.
- The offline ring already covers a tunnel that is down.
- README: a "Remote herdr" section with the `ssh -L` command, a note that
  the tunnel must be started by the user (for example as a launchd agent),
  and the caveat that `-L` with a Unix socket fails if the local socket file
  already exists (`StreamLocalBindUnlink yes` in `~/.ssh/config` fixes it).
- Tests: `loadConfig` accepts `socketPath`; the request tests already run
  against an arbitrary socket path.

Estimated effort: an hour including docs.

## Tier 2: multiple machines managed by the plugin

Large. Only worth doing if people actually run agents on several hosts.

- Config lists targets: `{ "name": "desktop", "ssh": "desktop.local" }`.
- The plugin owns each SSH tunnel: spawn `ssh -N -L`, health-check with
  `ping` through the socket, reconnect with backoff, clean up socket files
  on exit. The Plugin Service restarts the plugin freely, so tunnels must
  survive that or be re-established quickly.
- Choose how targets map to keys. Options: a fourth action group per target,
  a "machine" key that switches all groups, or merged lists with a per-tile
  host marker. Nine keys per group is the constraint.
- Recency tracking, pane ids and workspace numbers are per server. Keys must
  be namespaced by target to avoid collisions (`desktop:w1:p1`).
- Terminal activation for a remote target: the local `herdr --remote` client
  for that host may not be running; fall back to the known-terminal rules.
- Security: the plugin would run `ssh` as the user with their agent and keys.
  Document it, never store credentials, and keep the tunnel command visible in
  the config so users can audit it.

Estimated effort: several days plus hardware testing across two machines.

## Open questions

- Does herdr plan to expose a remote session through the local client's
  socket? If so, tier 1 becomes unnecessary and tier 2 shrinks to a target
  picker. Worth asking on the herdr issue tracker before building tier 2.
- Should a remote target be reflected in the tile label (a host prefix) or
  only in the group name?

## Decision

Start with tier 1 when someone needs it. Revisit tier 2 after 0.1.0 based on
demand.

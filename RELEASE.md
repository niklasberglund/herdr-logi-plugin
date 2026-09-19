# Release checklist

Things left to do before the first public release, then the steps for every
release. Tick items off as they are done.

## Before 0.1.0

### Repository

- [x] Create `github.com/niklasberglund/herdr-logi-plugin` and add it as the
      remote. The manifest and README URLs match that name.
- [ ] Commit the review changes and push. Confirm the CI workflow passes on
      GitHub.
- [ ] Add repo topics: `herdr`, `logitech`, `logi-actions-sdk`,
      `mx-creative-keypad`, `mx-creative-console`, `claude-code`, `codex`.
- [ ] Take a photo of the keypad showing live tiles and add it to the README.

### Hardware verification

- [ ] Look at the keypad with the current build: all three groups render, the
      offline ring appears when herdr is stopped, labels are blank for empty
      slots.
- [ ] Test each ring colour by driving an agent through idle, working, blocked
      and done.
- [ ] Test a Space key press when the workspace is already focused and has two
      or more panes (should cycle panes).
- [ ] Attach herdr from a second terminal (Terminal.app is always available)
      and confirm a press raises that terminal without configuration. Then
      test the `terminalApp` override and the empty-string opt-out in
      `~/.config/herdr-logi-actions/config.json`.
- [ ] Install the packed `Herdr.lplug4` by double-clicking, with the dev link
      removed (`npm run unlink`), and confirm the installed copy works on its
      own. Then uninstall it from Options+ and relink for development.

### Manifest

- [ ] Decide on `supportedDevices` in `package/metadata/LoupedeckPackage.yaml`.
      Community plugins use `LogitechCreativeFamily` and `MxCreativeKeypad`;
      the official demo uses `LoupedeckExtendedFamily`. Verify the chosen
      value loads under the Node runtime before adding it.

### Release

- [ ] Set the date for 0.1.0 in `CHANGELOG.md`.
- [ ] `npm run check` passes.
- [ ] Tag `v0.1.0` and push the tag. The release workflow attaches
      `Herdr_0.1.0.lplug4` to a GitHub Release.
- [ ] Download the release asset and install it once to confirm the CI-built
      package matches the local one.

## After 0.1.0

- [ ] Submit to awesome-herdr: one or two verb-first sentences under
      "Voice, hardware, and remote bridges". See its `AGENTS.md` for the entry
      format.
- [ ] Marketplace submission at https://marketplace.logitech.com/contribute,
      deferred for now. Needs: accept the developer agreement, hardware-tested
      package named `Herdr_<version>.lplug4`, valid `licenseUrl`,
      `supportPageUrl` and `homePageUrl`, and a short privacy statement (the
      README's "How it works" section already states no data leaves the
      machine). Review takes about ten working days.

- [ ] Decide whether to build remote herdr support. Scoped in
      [docs/work-packages/remote-herdr.md](docs/work-packages/remote-herdr.md).

## Every release

1. Bump `version` in `package.json` and `package/metadata/LoupedeckPackage.yaml`.
2. Move the Unreleased notes in `CHANGELOG.md` under the new version with today's date.
3. `npm run check`.
4. Commit, tag `vX.Y.Z`, push the commit and the tag.
5. Check the GitHub Release and its `Herdr_X.Y.Z.lplug4` asset.

# Release checklist

Open items, then the steps for every release. Tick items off as they are done.

## Done for 0.1.x

- [x] Create `github.com/niklasberglund/herdr-logi-plugin` and add it as the
      remote. The manifest and README URLs match that name.
- [x] Commit and push; CI passes on GitHub.
- [x] Hardware verification: all three groups render, ring colours, offline
      ring, pane cycling, terminal detection and the `terminalApp` override.
- [x] `supportedDevices: MxCreativeKeypad`. The MX Keypad is the MX Creative
      Keypad hardware relaunched; verified to load under the Node runtime (0.1.1).
- [x] Changelog dated, `npm run check` passes, `v0.1.0` and `v0.1.1` tagged and
      released with `Herdr_X.Y.Z.lplug4` attached.

## Before marketplace submission

- [ ] Download the latest release asset and install it by double-clicking,
      with the dev link removed (`npm run unlink`). Confirm the installed copy
      works on its own, then uninstall it from Options+ and relink.
- [ ] Take a photo of the keypad showing live tiles for the listing (and the
      README).
- [ ] Add repo topics: `herdr`, `logitech`, `logi-actions-sdk`, `mx-keypad`,
      `mx-creative-keypad`, `claude-code`, `codex`.

## Marketplace submission

- [ ] Submit at https://marketplace.logi.com/contribute: accept the developer
      agreement, upload `Herdr_<version>.lplug4`, and fill in the listing.
      - Description: the README intro.
      - Privacy statement: the README's "Privacy" section.
      - Homepage, support and license URLs: as in the manifest.
      - Reviewer notes: macOS only; needs herdr 0.8.2+ running locally;
        without herdr every key shows the dark red dotted offline ring.
        Ask them to confirm `MxCreativeKeypad` and that omitting
        `pluginFolderWin` is the right way to mark a Node plugin macOS-only.
- [ ] Review takes about ten working days. If there is no reply, email
      marketplace@logitech.com.
- [ ] After approval, add the marketplace link to the README's Install section.

## Other

- [ ] Submit to awesome-herdr: one or two verb-first sentences under
      "Voice, hardware, and remote bridges". See its `AGENTS.md` for the entry
      format.
- [ ] Decide whether to build remote herdr support. Scoped in
      [docs/work-packages/remote-herdr.md](docs/work-packages/remote-herdr.md).

## Every release

1. Bump `version` in `package.json` and `package/metadata/LoupedeckPackage.yaml`.
2. Move the Unreleased notes in `CHANGELOG.md` under the new version with today's date.
3. `npm run check`.
4. Commit, tag `vX.Y.Z`, push the commit and the tag.
5. Check the GitHub Release and its `Herdr_X.Y.Z.lplug4` asset.

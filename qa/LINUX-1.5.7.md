# Slide Studio 1.5.7 Linux package

Linux amd64 is added to the existing 1.5.7 release. This is a new platform package of the same application, with no changes to the Mac/Windows archives or runtime sources. The existing v1.5.7 tag remains unchanged; packaging and CI source are on main.

## Artifact and build

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-linux-amd64.deb | 132308476 | `83da6728e2f36a1cc4db123ec480fbdcadb2155ecb75ba6a24a97e477c85c7d1` |

Electron 42.11.15 Linux x64 is downloaded from its official release and checked against the runtime package's published checksum. ZIP CRCs, ELF64 x86-64 identity, required files and all Debian payload hashes/owners/modes pass. The package contains 76 regular files, a launcher symlink and the required directories. It installs the existing icon and desktop entry. Chromium's official sandbox helper is the only setuid payload, owned by root with mode 4755; the main app runs as the ordinary user.

The app ASAR SHA-256 is `05205776a1786db365fcc90b31d6e034f99d66a4e5fe4e5a3f51e5db63273ff0`, identical to Mac/Windows 1.5.7. A fresh TypeScript/Vite build passed and all 48 production source/assets match the release ASAR; its 49th file is the minimal package metadata. The [existing 1.5.7 application regressions](RELEASE-1.5.7.md) remain applicable without claiming another full-suite run.

`npm run package:linux` works on macOS/Linux with Python 3 and npm dependencies. `scripts/write-deb.py` uses the standard Debian 2.0 ar/control/data layout and verifies the generated payload before writing the final archive. It does not install packages on the build host. See [desktop packaging](../DESKTOP.md#linux-packaging).

## Native Linux verification

[Ubuntu 22.04 and 24.04 verification](https://github.com/beaur8-prog/slide-studio/actions/runs/39104535357) uses disposable GitHub-hosted x64 desktops under Xvfb/Openbox. Both use the exact public DEB hash above, ordinary-user execution, and Playwright's explicit `chromiumSandbox: true` (its default otherwise injects `--no-sandbox`). No sandbox, kernel or AppArmor protections are disabled.

- Install with apt; read back package/version/architecture, root ownership and mode 4755; validate desktop entry, launcher target, runtime shared libraries and every installed payload file.
- Launch the installed app and verify version/platform, sandbox/context isolation, no renderer Node access and no `--no-sandbox` switch.
- Import a three-slide PPTX with Korean titles, shapes and notes through the real project file input.
- Open object/text context menus, retain selected Korean letters, apply a partial text color and use native undo.
- Enter native fullscreen, advance with one small mouse-wheel input, use laser and pen and undo a drawn stroke, then return to editing.
- Export a PDF through the real export handler, stubbing only the OS destination picker in the disposable test.
- Insert long Korean text with automatic height, save/reload and reopen its original slide, and verify the chart data-link limitation notice.
- Reinstall and compare all payload files again, then uninstall. Preserve the profile sentinel and an unrelated local file while removing installed app, launcher, icon and desktop entry.

The initial checks exposed two test-harness issues: Playwright's sandbox default and reloading onto the first slide instead of the slide containing the test text. These were corrected without changing the app or package bytes.

## Installation and scope

Download [the amd64 DEB](https://github.com/beaur8-prog/slide-studio/releases/latest/download/Slide-Studio-linux-amd64.deb), then run `sudo apt install ./Slide-Studio-linux-amd64.deb` from its folder. Installation/update needs administrator privileges and may need a network connection for system dependencies. Launch **Slide Studio** from the application menu or run `slide-studio` as an ordinary user. Save work to .slide and close the app before updating. Remove with `sudo apt remove slide-studio`.

The app is installed under `/opt/slide-studio`. Its autosave profile is `$XDG_CONFIG_HOME/Slide Studio`, defaulting to `~/.config/Slide Studio`; removal preserves the profile and saved documents. This is a standalone DEB download, not a signed apt repository. No automatic updates or file associations are added.

Verified support is Ubuntu 22.04/24.04 x64 on an X11 desktop. Other Debian-family distributions, Wayland, ARM, RPM/AppImage, actual Korean IME keyboard composition, screen capture/portal permission dialogs and physical printer output are unverified or not provided. Existing PowerPoint layout/font compatibility limits still apply.

## Publication and cleanup

Linux is added to the existing GitHub v1.5.7 release and SHA256SUMS.txt; previous Mac/Windows binary bytes and download URLs are preserved. The existing Lithos download document is updated in place, retaining its public URL and running share/tunnel processes.

32 obsolete generated targets were removed: eight old app bundles, old extracted ASAR copies, four duplicate 1.4.2 ZIPs and a Python bytecode cache. Their logical file sizes total 4,985,942,536 bytes (APFS physical space reclaimed may differ). Current app/release binaries and 217 protected files, including all four historical profile backups, were hash-checked before/after cleanup. Source, user documents, regression fixtures and canonical QA records remain. Local ignored evidence is in `qa/results/linux-1.5.7/`, including native results, cleanup manifest, source comparison and publication verification.

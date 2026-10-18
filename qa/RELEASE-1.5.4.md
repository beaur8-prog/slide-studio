# Slide Studio 1.5.4 verification

This release adds the editor object context menu and gives slideshow ribbon tools their own label width, padding and spacing. Text/font import logic is unchanged.

## Local checks

- TypeScript production build passes.
- The object-context and presentation-ink suite passed all 14 tests (31.2 seconds). An explicit MouseEvent edge case recheck also passed; it tests both lower and upper menu bounds.
- Final focused regression: **32 passed, 0 failed, 0 skipped, 0 flaky** in 96.2 seconds, including table-selection, paragraph-editing and shell tests.
- The first expanded run passed 31 cases and read the old autosaved table formatting once. The test now polls the persisted fill/font-size values after Apply; the full focused run then passed all 32 cases. Application autosave and table formatting behavior were unchanged.
- Label checks use actual text Range bounds inside each button, in addition to icon/button vertical bounds, at 970, 1080, 1280, 1543 and 1920 pixels. Both hide/unhide states are exercised.
- Context checks cover right-click target selection, preserved multi-selection, copy/paste/cut, delete/undo, text editing, native editing context, layer order, locked-object protection, inspector, keyboard navigation, Escape, outside dismissal, resize and viewport edges.

## Packaging and native Windows

[Windows installed-app run](https://github.com/beaur8-prog/slide-studio/actions/runs/39093352372) passed on Microsoft Windows Server 2025 Datacenter, x64 GitHub runner, using the exact uploaded Setup/portable hashes. It verifies install, executable/runtime payloads, shortcuts/HKCU registration, real editor launch at version 1.5.4, actual ribbon text bounds at requested widths 970, 1080, 1280, 1543 and 1920 (the native minimum width clamps 970 to 1080; browser coverage also verifies 970), hide/unhide, object right-click menu/duplicate/native undo, presentation wheel/laser/pen/eraser/native undo-redo/F1/Escape, running-app update block, reinstall and uninstall while preserving profile and unrelated files. Native evidence and screenshots are retained in `qa/results/release-1.5.4/native/`.

Prior broad application checks are described separately in [1.5.3](RELEASE-1.5.3.md); this release does not claim a new complete broad-suite run. Physical Windows 10/11 devices, direct OS IME typing and paper printing were not exercised in this release.

## Package integrity

Both ZIPs pass complete CRC checks and share ASAR `5e7530f4a3faa891295361e15d65936d1dda4b8e67174ab9cb6c5a0ccd496a0f`. All 25 production files match the source/build output (package metadata is production-only). The extracted Mac app passes strict signature verification; Setup extraction verifies all 76 payload files.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 128951931 | `d5d9cdb0d48fdd3005db4d8fe48361500179a4caa5211579ef3ba3be136e137a` |
| Slide-Studio-win-x64.zip | 156124849 | `0f60010ca0b4f81b2e6d2c9349f0f330839d620b2af24c79a4ab3074855410ed` |
| Slide-Studio-Setup-x64.exe | 108786387 | `48bab64881d55784ee0a1172d21ad71bbd35fcdefeb9fcc680a066272b6eb510` |

## Same publication link

The existing Lithos share is refreshed through `ShareServer.update`; server/tunnel process, origin, token and source identity stay unchanged. Download filenames remain the same. The document integrates usage instructions for right-click editing and retains presentation-tool instructions. Public asset hashes and rendered document are checked after publication.

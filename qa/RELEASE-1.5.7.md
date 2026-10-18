# Slide Studio 1.5.7 verification

This release includes automatic wrapping/height for newly inserted text boxes, wrapping and height controls for existing boxes, a chart data-link limitation notice before insertion, and inherited native PPTX text-column count/gap preservation. Fixed imported layouts remain unchanged until the user enables automatic height. Automatic-height settings persist in .slide projects; PPTX receives the calculated geometry.

The production fixes in `af0ad93899c73281425a1df09d1a9477002794c2` passed the complete 178-case suite: **176 passed, 2 environment skips, 0 failures**. The skips require a local Office font cache and native Windows fullscreen on the Mac. [Detailed text/layout checks and three additional public decks](TEXT-LAYOUT-2026-10-18.md) describe the source corpus and limits.

Linux amd64 is also available in this same release. See [Linux package verification and installation](LINUX-1.5.7.md); the Mac/Windows binaries below remain unchanged.

## Release checks

All 14 release-specific browser checks passed: long Korean/no-space text, automatic height and manual height/undo, project persistence/PPTX geometry, the three pinned workplace decks, inherited two-column text, chart/insertion dialogs and production assets. The packaged `dist` and `electron` files are byte-identical to the fully tested development build; only application version metadata changes. This justifies reusing the complete 176-pass suite above without claiming a second full run.

Both ZIPs passed full CRC checks. All 49 production files/metadata in each ASAR match the release build. The extracted Mac bundle passed strict ad-hoc signature, icon and version checks. All 76 Windows Setup payload files, version/icon and per-user installer manifest passed verification.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129642912 | `04bfa90778344aea302e5cc583f2a3a965fab1408fbf45dca9a961a8052064d8` |
| Slide-Studio-win-x64.zip | 156815827 | `61f6f5fa4d779ad09218f61cc5e11591277384165b26a9a402af5e832b3817a3` |
| Slide-Studio-Setup-x64.exe | 109478974 | `682f63864b56b210e6bf841a41f0d106364dc97df3264f9d00df8af41fea215f` |

Both platform ASARs have SHA-256 `05205776a1786db365fcc90b31d6e034f99d66a4e5fe4e5a3f51e5db63273ff0`.

A verified Mac bundle replaced the repository-local `release/Slide Studio.app` after a normal saved exit. Version 1.5.7 was reopened and the existing five-slide user document was restored. The previous bundle was retained. This updates the local development/release path, not an unrelated copy in /Applications.

## Native Windows

[Native Windows run 39103379122](https://github.com/beaur8-prog/slide-studio/actions/runs/39103379122) passed on Windows Server 2025 Datacenter with the exact Setup and portable hashes above (source `b92e52d95b6a34274861829c0c199f4684780e8f`).

- Clean install, all installed payload hashes, shortcuts and Apps & Features registration passed.
- Installed-app long Korean wrapping and automatic height, manual height mode, reload persistence and chart limitation notice passed. Native screenshots show all lines inside the text box and both settings enabled.
- Text/object context menus, native clipboard, partial color and native undo, original-font import/reload/removal passed.
- Ribbon containment passed at actual widths 1080, 1280, 1543 and 1920 px; the native minimum clamps a requested 970 px to 1080 px.
- Slideshow wheel/Escape, laser, pen, eraser, ink undo/redo and tools passed.
- Silent replacement was blocked while the app was running without closing that instance. In-place reinstall, uninstall, user profile and unrelated-file preservation passed.

## Publication

Version 1.5.7 is the latest public GitHub release. The original four `releases/latest/download/` addresses were fully downloaded again; every byte count and SHA-256 matches the local release file and GitHub asset digest. All four resolve to v1.5.7.

The existing [Lithos download document](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) was updated through the running service's `ShareServer.update` operation. Its URL/token, creation/expiry, vault identity, server PID/port and tunnel PID/origin were preserved; neither service was restarted. Reviewed public content and all seven screenshot bytes match the prepared guide, and download addresses are unchanged. The rendered page shows 1.5.7, the OS-warning notice and current Mac/Windows downloads.

Local ignored evidence is under `qa/results/release-1.5.7/`, including package/source verification, native installation and app reports, public download verification, share identity snapshots and `download-document.png`.

## Limits

Mac uses ad-hoc signing without Apple notarization. Windows has no distribution certificate. Physical Windows 10/11 IME typing, actual screen-capture permission prompts, paper printing and pixel-identical PowerPoint rendering are outside this release's verification scope.

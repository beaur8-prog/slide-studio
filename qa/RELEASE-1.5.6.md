# Slide Studio 1.5.6 verification

Production source: `e4b2f8befd25e26f72efb48688559a2465ae43bd` (tag `v1.5.6`). Later test/documentation commits do not change the packaged application.

## Changes and regression coverage

The release includes preserved text selection across right-click and Home ribbon interactions, partial text color with Apply/Cancel, native text clipboard/undo, local original-font import and persistence, Office Calibri discovery and extended Unicode fallback metric corrections.

The withheld 1.5.5 candidate exposed a native Windows defect: coloring the first two letters of plain `OUR APPROACH` created separate column-flex items and split the text across lines. An inline formatting container now isolates editing runs from the outer flex layout. A new regression failed before the fix and passes afterward, including visible line geometry, undo/redo and reload. Imported paragraph structure and static unformatted rendering remain unchanged. The 1.5.5 candidate was withdrawn to a private draft before becoming the latest download.

Across the full regression run and targeted rechecks, **168 unique cases passed, 2 were skipped, and no failures remain unresolved**. Coverage includes PPTX geometry/round trips, Korean composition simulation, 300-slide editing, tables, object and text context menus, partial color, font handling, print/PDF and slideshow tools/navigation.

The initial full run had 167 passes, 2 skips and one wall-clock-sensitive wheel momentum test failure. Rendering delayed a nominal 40 ms event beyond the application's 80 ms quiet interval. Test-only timing corrections use the Playwright clock for momentum arrival and synchronously queued events for a burst. The 13 related navigation checks then passed; production wheel behavior was not changed. This result combines the full run and rechecks, rather than claiming a single clean full run.

Skipped cases were a cached Arial Nova Light file unavailable on this Mac and native Windows fullscreen on macOS. The separate Windows native test below covers installed-application presentation navigation. Results are retained locally under `qa/results/release-1.5.6/` (ignored generated evidence).

## Packaged files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129642060 | `35c4dff91b64806e4232c5de2253a677cadaf8eabdc1b51eedec2e7a13fea1ed` |
| Slide-Studio-win-x64.zip | 156814979 | `4ff0d4a3eee8cfae7c041222baee7baa4d244da85736a89610f50544cb65f69e` |
| Slide-Studio-Setup-x64.exe | 109609508 | `92d3dd0d659ee11ad41b7c29d9d040772a95d747da1edd61902529c65f0a5dfa` |

Both ZIPs passed complete CRC checks. Both applications contain the same ASAR SHA-256:

`a3b68589d411de76a494fb4454b8b9a40bf87b6537e961bce4ec8a0213aedb87`

All 49 production files in each ASAR match the built production source and metadata. The extracted Mac application passed strict ad-hoc signature, version and icon verification. Windows Setup passed all 76 payload file hashes, version/icon, installer whitelist and `asInvoker` checks. These packages have no Apple notarization or Windows distribution certificate.

## Native Windows installation and interaction

[Native Windows run 39101323188](https://github.com/beaur8-prog/slide-studio/actions/runs/39101323188) passed on Microsoft Windows Server 2025 Datacenter using the exact Setup and portable SHA-256 values above.

- Clean install, installed payload hashes, shortcuts and Apps & Features registration passed.
- Installed application launch, editor rendering, text selection/context menu, native clipboard, partial color and native text-color undo passed.
- Original-font import, persistence across restart and removal passed.
- Presenter-note and hide-slide labels remained contained at actual viewport widths 1080, 1280, 1543 and 1920 px. The native minimum clamps a requested 970 px viewport to 1080 px.
- Slideshow wheel navigation, Escape restoration, laser, pen, eraser, ink undo/redo and tool menu passed.
- A running app blocked silent replacement without closing the running instance. In-place reinstall and uninstall passed. User profile and unrelated files were preserved.

Native test failure cleanup has bounded waits and terminates only the owned disposable CI application on failure, avoiding an unsaved-close modal deadlock. Successful runs still close normally. Product save/close safeguards are unchanged.

## Local Mac application

A separate signed temporary bundle produced the ZIP while the Mac was locked. After unlocking, the saved app was quit normally, the verified bundle atomically replaced the repository-local `release/Slide Studio.app`, and version 1.5.6 was reopened. The existing five-slide user document was restored. Its ASAR matches the release package. No user document/profile was replaced; the previous local bundle was retained as a backup.

## Publication verification

Version 1.5.6 is the latest public GitHub release. All four original `releases/latest/download/` URLs were fully downloaded again; their complete byte counts and SHA-256 values match the local release files and GitHub asset digests. Each URL resolves to v1.5.6.

The existing [Lithos download document](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) was refreshed through its running `ShareServer.update` operation. The share URL, token, creation/expiry, vault identity, server PID/port and tunnel PID/origin were preserved; neither service was restarted. Public content matches the reviewed source, all five public screenshot assets match prepared files, and the download URLs are unchanged. The rendered page was visually checked for the 1.5.6 heading and Mac/Windows download instructions.

Local evidence: `publication-verification.json`, `live-update.json`, `public-after.json`, `share-state-after.json`, `github-published.json` and `download-document.png` under the ignored release results directory.

## Limits

Physical consumer Windows 10/11 devices, direct operating-system IME typing, actual screen-capture permission prompts and paper output were not tested in this release. Korean input regression uses composition simulation. The native Windows evidence comes from a hosted Windows Server runner.

Without the original font, fallback glyphs and wrapping can still differ. Original fonts reduce substitution but do not reproduce all PowerPoint shaping/layout behavior. Added fonts are device-local and are not embedded in projects or PPTX files. The application does not implement every PowerPoint feature.

# Slide Studio 1.6.0

This release includes the remaining editor and PPTX compatibility improvements from `b655122`, plus a merged-cell hit-target fix found during release verification. Invisible row/column dividers no longer intercept clicks inside merged cells. The same installed-app fixture exercises shape text paste, grouped duplication/undo, merged-cell input/Tab navigation, separate presenter control/private notes, retained highlighter strokes and reload.

## Changes

- Group hierarchy, grouping/ungrouping, marquee/multiple selection, rotation, alignment/distribution and slide block operations.
- Native imported/merged tables, inline input, rich cell formatting, merge/split, TSV paste and optional automatic row growth, up to 100 rows × 50 columns.
- Shape-internal text; independent fill/line/text alpha; text insets, partial links, list types, 187 preset geometries, DrawingML guides, gradients, dash patterns and outer shadows.
- Supported rich-text paste, word/operation undo checkpoints and no duplicate canvas object when pasting inside a text editor.
- A separate presenter window with current/next slides, private notes and timer; macOS fullscreen workspace handling; highlighter and keep/discard ink.
- TTC/OTC face extraction and local registration. Fonts remain device-local and are not embedded or redistributed with documents.

## Regression and corpus evidence

The pre-release source check covered 253 tests: 251 effective checks passed and 2 environment-specific checks were skipped (Windows native fullscreen and a locally absent Office Arial Nova Light face). The full run initially had one obsolete assertion expecting imported table cells as separate text boxes; the corrected native-table assertion passed in the targeted rerun. Details remain in [the issue status](../powerpoint-issues/STATUS.md).

The 1.6.0 build is checked again with production asset/font/PPTX input/export tests, the shared partial-format/number/list fixture and the new installed-app fixture. Related native-table/boundary regressions exercise both row and column handles, rotation, cancellation, undo and native PPTX round trips.

Eight public PPTX files, 499 slides including a 192 MiB input, opened and completed a PPTX round trip without runtime errors. The imported model's text and image counts were preserved in all eight files. This does not imply preservation of original unsupported chart/media data. Across all slides, automatic glyph overlap and off-slide text candidates were zero. One DSU cell had a 2.6 px line-box overflow candidate; its glyph bounds and screenshot remained inside the cell. Forty-five representative screens were captured.

## Compatibility and distribution

PowerPoint master editing, native data-linked charts, playable media, complex animations and full typography/effect parity remain outside the supported subset. See [current limits](../powerpoint-issues/STATUS.md) and [file compatibility](../IO_NOTES.md).

Mac ARM64 ZIP, Windows x64 Setup/portable ZIP and Linux amd64 DEB are built from runtime commit `896015c871ee6db67b55b3e875d44201f49d8e59`, tagged `v1.6.0`. All 51 compiled renderer/native files match the production source, and every package contains the same `app.asar` (SHA-256 `81657c34f36ade2f7a1811d01072f2946d44e40f409f423f899785f1bc855429`). Subsequent commits change QA readiness and documentation only.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| Mac ARM64 ZIP | 129787256 | `467681b3dd220411307423824e756b7a75ed74033aabbf015a56330b75fd3d15` |
| Windows x64 portable ZIP | 156960174 | `042c65d9fac6e02b2c0cc615338e66ec4d96b07bfd927285be9def12384e618c` |
| Windows x64 Setup | 109581878 | `94be2b993286da60b2623583b23f9426c9cb50b62218e46f6749ccb813624eae` |
| Linux amd64 DEB | 132447802 | `6c5a9df396d08a8df769835bc01f31fda652f2495b5def47e0acdc9e50635a10` |

The final related source tests passed **15/15**, without skips. This is a targeted release run; the earlier 251 effective checks are not counted as another complete run at the final commit.

- [Windows installation and native app verification](https://github.com/beaur8-prog/slide-studio/actions/runs/39173013578), attempt 2, passed on Windows Server 2025: install, payload hashes, shortcuts/registration, native editing/presentation checks, in-place reinstall, uninstall and profile/unrelated-file preservation.
- [Ubuntu 22.04 and 24.04 installation and native app verification](https://github.com/beaur8-prog/slide-studio/actions/runs/39173800477) passed on both distributions: DEB payload hashes, shared libraries, root-owned mode-4755 sandbox helper, native editing/presentation/PDF checks, reinstall, uninstall and profile/unrelated-file preservation. The Chromium sandbox remained enabled.
- The shared installed-app fixture passed all 11 new feature checks on Windows and both Ubuntu versions. It checks shape-text paste without extra objects, group duplication/undo, native merged cells and Korean input/Tab traversal, presenter control/private notes, highlighter, retained ink and undo/redo/reload. Existing partial-format, numeric-input and bullet-list scenarios also passed.
- On the Mac, the released 1.6.0 application was opened and its version checked. The user's six-slide document, existing text changes and presenter notes were preserved. The extracted public bundle and installed app passed strict ad-hoc signature verification; this is not Apple notarization.

QA-only corrections await the saved indicator after reload before closing an installed app, and await native fullscreen geometry/focus before coordinate-based ink input. Earlier Linux attempts exposed those automation races; the final checks retain the drawing assertions and use the same release binaries. Initial native download attempts could not access a draft release; the successful runs used the publicly staged package.

Mac is not Apple-notarized; Windows has no distribution code signature. Browser download reputation warnings and **Windows protected your PC → More info → Run anyway** may appear. These warnings and institutional restrictions are explained in the integrated download guide; security protections are not disabled. Linux is a standalone unsigned DEB, with the Chromium sandbox retained.

Windows CI uses a hosted Windows Server image, rather than a physical Windows 10/11 PC. Linux checks use Ubuntu 22.04/24.04 X11. Physical Windows/Linux keyboard IME typing, Wayland, screen capture permissions and paper printing remain outside these checks.

The existing [Lithos download and usage guide](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) is updated through its running service's `ShareServer.update`, keeping the same URL, token and tunnel. Public binary URLs retain their existing `/releases/latest/download/` paths.

The [1.6.0 release](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.6.0) was promoted to the latest non-prerelease on 2026-10-19 (KST). All four public packages and `SHA256SUMS.txt` were downloaded in full through the unchanged stable URLs; their sizes/hashes match the verified local artifacts and GitHub asset digests, and all redirects resolve to `v1.6.0`.

The public Lithos document matches the reviewed 1.6.0 source, including current usage, limitations and download/installation warnings. All 12 public images match their reviewed source files. Its URL, token, creation/expiry, server PID/port and tunnel PID remained unchanged. The existing browser tab was reloaded and visibly showed 1.6.0, updated instructions and the Windows download/PC-protection warnings. Screenshots and the full publication assertions are stored with the local evidence below.

Local evidence: `qa/results/release-1.6.0/`, `qa/results/remaining-fixes/` and `qa/results/remaining-fixes-corpus/` (ignored by Git).

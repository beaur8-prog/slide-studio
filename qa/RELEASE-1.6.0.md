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

Mac ARM64 ZIP, Windows x64 Setup/portable ZIP and Linux amd64 DEB are built from the same renderer/native source. Release package hashes, native OS run links and publication checks are recorded below after verification.

Mac is not Apple-notarized; Windows has no distribution code signature. Browser download reputation warnings and **Windows protected your PC → More info → Run anyway** may appear. These warnings and institutional restrictions are explained in the integrated download guide; security protections are not disabled. Linux is a standalone unsigned DEB, with the Chromium sandbox retained.

Windows CI uses a hosted Windows Server image, rather than a physical Windows 10/11 PC. Linux checks use Ubuntu 22.04/24.04 X11. Physical Windows/Linux keyboard IME typing, Wayland, screen capture permissions and paper printing remain outside these checks.

The existing [Lithos download and usage guide](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) is updated through its running service's `ShareServer.update`, keeping the same URL, token and tunnel. Public binary URLs retain their existing `/releases/latest/download/` paths.

Local evidence: `qa/results/release-1.6.0/`, `qa/results/remaining-fixes/` and `qa/results/remaining-fixes-corpus/` (ignored by Git).

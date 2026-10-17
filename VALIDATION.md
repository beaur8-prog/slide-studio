# Verification record

Verified on 2026-10-18 (KST), macOS arm64.

## Current release: 1.4.2

The editor now accepts small mouse-wheel notches without waiting for 60 pixels
or a fixed 350 ms cooldown. One continuous gesture advances one slide; a quiet
gap or direction reversal permits the next navigation. The 20 px / 120 ms
comparison advanced on the third input in 1.4.1 and the first input in 1.4.2.
The production build passes, and the full suite reports **90 passed, 2 skipped,
0 failed, 0 flaky** in 143.2 seconds. New checks cover small notches, reversal,
line-mode input, tiny jitter and a long momentum tail. Existing zoom, scrollbar,
thumbnail and presentation checks also pass. See [1.4.2 release evidence](qa/RELEASE-1.4.2.md).

The prior corpus and native save/export results below are historical 1.4.1
checks, not new 1.4.2 measurements. The release report states the current native
and package verification scope.

## Version 1.4.1

Includes the PC changes through `16c80d8`: presentation navigation and command
isolation, paragraph editing and import fidelity, and saved-library memory
release. The production build passes. The full automated suite reports
**88 passed, 2 skipped, 0 failed, 0 flaky** in 136.3 seconds. The skips require
Windows native geometry and an actual Office font cache. The only test change
uses Cmd+Up/Down on macOS to collapse text selection at the document boundaries;
Cmd+Home/End scroll without moving the caret. Application behavior was not
changed to satisfy those tests.

The actual Mac ZIP was extracted, signature-verified, installed and launched.
Native checks covered Korean/English multiline paste and a blank paragraph,
hidden-slide navigation and numeric jumps, blackout restoration with English
input, command isolation, end screen and Esc, project save, PPTX export/reopen,
and four-page PDF export. All PDF pages were rendered and visually checked.
The original user document was restored afterward.

All five public PPTX decks / 465 slides passed open/export/reimport checks,
including the 201 MB file. A 13.77 MiB saved-library image fixture was released
after each of five close paths and a late asynchronous completion. This measures
JavaScript heap retention, not total OS memory. Both ZIPs pass CRC32 checks and
contain the same 1.4.1 ASAR; its production assets and Electron shell match the
working copy. Windows runtime and PE checks pass, but this new Windows ZIP was
not executed on Windows in this Mac session. Real OS IME composition and
physical printing remain unverified. See [1.4.1 release evidence](qa/RELEASE-1.4.1.md).

## Version 1.4.0

The PC changes through `3b15e73` are included in both packages. TypeScript and
the production build pass; the full automated suite reports **58 passed,
2 skipped, 0 failed**. The skipped cases require Windows native window geometry
and an actual Office font cache. Two font regression tests now distinguish a
missing Windows font from clipping or text loss on macOS. No production font
mapping was changed to satisfy these cross-platform tests.

The actual Mac ZIP was extracted, strictly signature-verified, installed and
launched. Native checks covered fullscreen presentation, next-slide navigation,
Esc returning to the editor, Korean/English multiline paste and undo, exact
project save round trip, PPTX export/reopen, editor slide navigation and PDF
export. All four PDF pages were rendered and visually checked; Korean text and
backgrounds are present, and notes/editor controls are excluded. This is not a
real keyboard IME or physical printer check.

All five public decks / 465 slides were rechecked on macOS Chrome, including
the 201 MB sample and five export/reimport cycles. Both ZIPs pass CRC32 checks
and contain the same 1.4.0 ASAR with current source/build bytes. The Windows
runtime's checksum, PE x64 structure and executable code preservation were
verified. Prior PC native evidence is in `POWERPOINT-ANALYSIS.md`; this newly
generated Windows ZIP was not launched on Windows in this Mac session.
See [1.4.0 release evidence](qa/RELEASE-1.4.0.md) for metrics and remaining limits.

## Version 1.3.0

Mac ARM64 and Windows x64 packages are available from [GitHub Releases](https://github.com/beaur8-prog/slide-studio/releases). The shared editor and Windows path/shortcut checks total 33 passing automated tests. Windows native execution, IME and printing are not verified. See [current scope and reproducible commands](qa/README.md).

After the Mac was unlocked, the installed 1.2.1 app successfully opened a native PDF save dialog and exported four Korean slides at 960 × 540 points. All pages were rendered and visually checked. Native printing returned `No printers available on the network`; `lpstat` confirmed no registered printers. No physical print job was sent. This check applies to the installed 1.2.1 build, not a native launch test of the 1.3.0 download.

The records below preserve earlier development stages. Links into ignored `qa/results`, `qa/samples`, and `release` directories refer to local evidence and are not available in this repository. Later records supersede earlier version-specific limits.

## Version 1.2.1: fonts and wrapping

- Bundled official Nanum Barun Gothic with OFL, preserved Latin/East Asian faces independently, and retained character spacing, kerning threshold, language, tabs and paragraph break flags through project/PPTX edits and round trips.
- Added Calibri vertical-metric aliases and a measured Calibri Light fallback. A 27-line, six-page comparison outside the calibration page reduced mean absolute relative width error from 1.24% to 0.23%; this is a bounded sample, not a universal accuracy claim.
- Corrected grouped text sizes being multiplied by the group's geometry ratio. CMU 3 slide 34 now retains 20 pt labels and its known last algorithm line fits one line.
- `npm test`: **31 passed (56.8s)**, including five font regressions and a built-assets test that loads the bundled Korean font. Rechecked all five public decks / **465 slides**, visually inspected 35 representative corpus screenshots, and completed all five PPTX round trips without lost model text or image counts. Explicit clipping, off-slide text and line-bound overlap candidates were zero. Tab-only blank extents are excluded from the updated range checker.
- Final 201 MB file: 1.94s to editor UI, 1.99s to saved; one run with parser/cache warmup. The 300-slide fixture reopened in 1.464s, ten keys took 0.241s and blur-to-saved took 0.885s.
- Packaged and installed 1.2.1. Strict signature verification passed and installed app/font hashes match the staged bundle. Mac remains locked; no native re-launch or real printer/keyboard-IME recheck is claimed.
- See [current report](qa/REPORT.md), [font notes](FONT_NOTES.md) and [prior 1.2.0 report](qa/REPORT-1.2.0.md).

## Version 1.2.0: layout compatibility fixes

- Fixed the recorded footer overlaps/clipping and invented borders; restored TIFF images, editable table cells and merged-cell geometry, image crop/flip, numeric freeform paths, and master/layout artwork. Read cached SmartArt drawings as editable shapes, connectors and text.
- Preserved run formatting, paragraph alignment/spacing, source overflow behavior and Korean vertical text. Corrected mixed-size blank-line heights, multiline table row allocation and first/last paragraph edge-spacing defaults. Bundled Carlito as a Calibri fallback with required font/decoder licenses.
- `npm test`: **25 regression tests passed** (45.8s), including ten public slide regressions, Korean composition/undo/redo/autosave and rich-text/PPTX round trips. Final 300-slide fixture: 1.476s reload, 0.166s for ten automated keystrokes, 0.885s blur-to-saved.
- Rechecked five public files, **465 slides**, with three opens per file and one complete export/reimport per file. All 15 runs completed with no page exceptions. Slide counts, text and image counts survived all five model/PPTX round trips. Inspected 41 final corpus screenshots and one additional organization-chart regression screenshot. See [the updated report](qa/REPORT.md) for evidence and candidate-count caveats.
- `npm run package`: TypeScript, production assets, signed bundle and ZIP succeeded. `npm test -- tests/production.spec.ts`: **one additional production smoke test passed** (10.0s) using only built assets, including actual UI export/reopen and TIFF/font loading. Combined: 26 passing tests across these runs.
- Installed **1.2.0** at `/Applications/Slide Studio.app`; `codesign --verify --deep --strict` passed. Installed `app.asar` SHA-256 matches the verified staging app: `3f1fb7f7a7b966a6c0fdd2063f50ea057608097712019e4223e4506a3d02b4d8`. Package metadata and ZIP digest are in [BUILD.json](release/BUILD.json).
- The app must be reopened, then original PPTX files reimported to recover objects omitted by earlier importers. Existing saved projects remain compatible. Missing fonts can still change glyphs or wrapping; charts, some vector formats, complex effects/transforms and dynamic SmartArt remain limited. The Mac is still locked, so native launch, macOS input-source behavior and native printing were not reverified.

## Version 1.1.1: public corpus, Korean composition, and performance

- Downloaded five public PPTX files (465 slides, 1.89–191.80 MiB) and four corresponding public PDFs. All 15 repeated imports, editor opens, saves, and sampled slide switches completed without page exceptions.
- Audited all 465 slides for text box overflow/intersection and inspected 33 representative slide screenshots. **Layout fidelity failed**: confirmed text overlap/clipping, missing tables and images, and incomplete equations. Candidate counts are heuristics, not counts of confirmed defects. See [the original Korean QA report](qa/REPORT-1.1.1.md) for original/app comparisons, sources, and raw results.
- Fixed text body inheritance/wrapping/font scale and diagonal connector geometry. Reduced repeated whole-deck cloning/serialization and unchanged thumbnail rendering. Unified file input at 256 MiB and switched native byte transport to typed arrays while preserving decompression limits.
- `npm test`: all 10 tests passed, including Korean composition/mixed text/newlines, undo/redo, autosave/reload, project/PPTX round trips, a 300-slide editing fixture, and native byte validation.
- The final 300-slide run processed 10 automated keystrokes in 0.139s, versus 0.824s before optimization. These are individual test runs, not a universal performance guarantee.
- `npm run package`: TypeScript, production build, ad-hoc signing, strict signature verification, and ZIP generation passed. Vite retained its informational large-chunk warning (about 705 kB uncompressed JavaScript).
- Installed version **1.1.1** at `/Applications/Slide Studio.app`. Strict signature verification passed and installed `app.asar` SHA-256 matches the verified staging bundle: `dfb54273a33e817f24044eff62ab401b5126c2915cfc6cd576f4905470898046`.
- These UI measurements used isolated headless Chrome 155 on Apple M4 and the development editor. macOS input-source behavior, live native file IPC/dialogs, native print dialogs, and a launch of the updated installed app were not verified because the Mac remains locked. Reopen Slide Studio to load the update.

## Version 1.1.0: native printing update

- Added editor **파일 → 인쇄**, native **File → Print…**, and Cmd/Ctrl+P. The desktop bridge opens the system print dialog with backgrounds enabled and landscape orientation. It waits for fonts and images before printing and reports submission, cancellation, or failure.
- `npm run package`: TypeScript, production build, and signed app/ZIP generation passed.
- `npm test`: the existing six file compatibility/validation tests passed. These are regression tests for file handling, not a test of native printing.
- Installed version 1.1.0 at `/Applications/Slide Studio.app`; verified its bundle version and strict code signature.
- Native print-dialog and physical printer verification were not performed: the Mac was locked and the user said unlocking was not currently possible. The previous native execution/PDF checks below apply to version 1.0.0. No physical print job was submitted.
- The app must be reopened to load the update if an older version is already running.

Print API reference: [Electron webContents.print](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback), also checked against the installed Electron type declarations.

## Version 1.0.0: initial automated checks

- `npm run build`: TypeScript and production Vite build passed.
- `npm test`: 6 tests passed. Editable PPTX round trip preserves geometry, text formatting, image bytes, opacity, notes, and fade. Additional cases cover relationship order, layout/theme inheritance, invalid JSON, hostile XML/archive sizes/paths, and compatibility warnings.
- A false warning caused by an empty `ppt/embeddings/` ZIP directory was found in manual and automated testing and fixed. Empty directories no longer trigger macro warnings.
- `npm run package`: standalone Electron .app and ZIP created.
- `codesign --verify --deep --strict` passed for the staged bundle and `/Applications/Slide Studio.app`.

## Browser interaction checks

Used the running editor through actual controls to insert and directly edit Korean text, change bold/italic/font size, undo/redo, move and resize by dragging, add/duplicate/delete slides, edit notes, navigate a slideshow, set fade transitions, change and undo a theme, change a slide background, insert a triangle, lock/unlock it, center it, and insert a PNG file.

Saved a `.slide` file, exported a `.pptx`, and reopened that PPTX through the file chooser. Five slides and the edited Korean text remained editable. Reloading the editor restored saved changes. No application JavaScript errors appeared in the browser console.

## Native application checks

Opened the independently packaged app without a development server. Inserted text and used Cmd+Z to remove it. Cmd+S opened the native save dialog and wrote `tests/fixtures/native-validation.slide`; the resulting file contains the expected four slides and 28 editable elements.

The native PDF dialog wrote `tests/fixtures/native-validation.pdf`. Poppler reported four pages at 960 × 540 points. All four rendered pages were visually inspected: Korean text, colors and geometry are intact, and no editor chrome or presenter notes appear in the output.

Installed the verified bundle at `/Applications/Slide Studio.app` and verified its signature again. The Mac became locked before the optional second launch from the installed path, so that specific second launch was not observed. The identical staged bundle's launch and native save/PDF operations were observed.

## Limits

PowerPoint itself was not launched. Compatibility is the documented subset in `IO_NOTES.md`, not a claim that all PowerPoint documents render identically. Tests use Chromium and the packaged macOS app; Windows/Linux packages and a separate-monitor presenter view were not produced.

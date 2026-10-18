# Numeric input commits after typing (local follow-up)

The reported arrow-width cases were reproduced before the fix: typing `200` produced `1600`, and `160` produced `1660`. Inspector inputs clamped the first digit to the minimum width of 16 and immediately replaced the controlled value.

Inspector geometry, opacity and stroke fields, and Home font size now keep a local input draft. Enter or focus departure validates/clamps and commits once. Escape cancels; empty or incomplete numbers restore the previous value. Keyboard arrows still increment/decrement. Leaving a field by clicking another object commits before canvas selection changes, keeping the value attached to the original object. Selection-specific keys discard stale control state when the new object has the same initial value.

## Verification

- **26 tests passed**, no failures/skips (1.1 minutes): 9 numeric-input cases, long Korean text/automatic height, object context-menu copy/paste and undo, and partial text formatting regressions.
- Covered `200`/`160` sequential typing, no geometry changes while typing, single-edit undo/redo, autosave/reload, Tab, Escape, empty/incomplete input, negative/decimal coordinates and dimensions, bounds, keyboard increments, object switching, multi-selection, and Home font size.
- Existing long-text tests now explicitly confirm numeric drafts with Enter. The resize undo check uses the app's Undo button instead of a shortcut inside the notes textarea, which invokes the browser's text-input undo history.
- TypeScript/Vite production build and `git diff --check` passed.
- In an isolated native Mac app, selected an inserted arrow, typed each digit separately, confirmed that the initial `2` stayed `2`, and committed widths `200` and `160`. One native Cmd+Z restored width `200`. Screenshot: `qa/results/number-input/native-width-160.png`.
- Native Windows/Linux execution was not repeated for this local follow-up.

## Expanded report recheck

- Rechecked the expanded report against runtime source commit `d7feaac`: **20 tests passed** (54.5 seconds), including all numeric-input and partial-formatting tests.
- Added seven-slide fixtures with text, arrow and image objects. For each object type, entering `200` for width and height and `-15` for rotation preserves the draft and commits the exact value. Text font size `24` also passes. Reload preserves the values and leaves the first slide's objects unchanged.
- The running local Mac app's ASAR matches the corrected build (`17e5687e…`), with all 48 production files matching the local build output. The existing public Mac and Windows ZIPs still contain the older ASAR (`05205776…`); these fixes have not been publicly released.
- This recheck changes tests and this QA record only. The already-correct running app and the user's saved document were left open without replacement.

## Scope

Git and local Mac app only; base version stays 1.5.7. No release, version tag, public download replacement or Lithos document change. Existing Mac ZIP, Windows ZIP/Setup and Linux DEB hashes are unchanged. The staged Mac bundle passes strict signature verification; the installed copy has the same ASAR and passes normal signature verification. Documents' file provider adds FinderInfo metadata, so strict verification is performed outside Documents.

Local ASAR SHA-256: `17e5687e684c86ccc0abe8bc28382543c8273463312d5b5c9c9506161258c3bc`.

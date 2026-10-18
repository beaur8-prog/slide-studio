# Partial text color and explicit Apply (unpublished local follow-up)

The old Home color input called whole-object formatting as soon as its color changed, and focusing it ended text editing. Home now opens an explicit-Apply palette, also available from the text context menu. The source text selection remains visible while choosing a draft. Apply colors only the saved range; Cancel/Escape change nothing and restore selection. Home tab changes and context-menu-to-Home transfer preserve the range. The context route also works when the Home trigger is not mounted. Whole-object mode is identified in the palette; an editing caret cannot accidentally recolor the entire object.

## Verification

- Final focused suite: 33 passed, 0 failed/skipped/flaky, 91.4 seconds. It includes 10 new color cases and existing text context, paragraph, Korean input, editor and native IPC coverage.
- A subsequent targeted recheck verifies the initial color comes from the first selected letter when the range begins exactly at a run boundary (passed, 3.6 seconds).
- Tests verify no document changes before Apply, Cancel/outside/Escape behavior, invalid codes, Home tab transfer, context-to-Home transfer, a missing Home trigger, partial range across runs/paragraphs, preserved run attributes, soft breaks/blank lines and fixed paragraph spacing, continued typing color, native undo/redo, autosave/reload and exact selected color preservation through PPTX export/import.
- One initial expanded assertion counted ‘둘째 줄’ as five characters instead of four; after correcting that expected length, the expanded suite passed. Raw logs are retained in `qa/results/text-color-selection/`.
- Production TypeScript/Vite build passed. Local Mac ASAR files match current production sources; the temporary app bundle passes strict signature verification.
- In the actual user Mac app, ‘더 나은’ was selected and Home Font Color opened a palette with that source range highlighted and Apply/Cancel visible. Choosing a red draft and cancelling restored the original range. The right-click Color entry then opened the same palette. The user's document colors were not changed by these manual checks. Screenshot: `qa/results/text-color-selection/native-color-palette.jpg`.

## Scope

Git and the local Mac app only. Base version remains 1.5.4; no release/tag, public download or Lithos document update was performed. Existing published Mac ZIP, Windows ZIP and Setup retain their recorded SHA-256 values. Native Windows execution was not repeated for this local follow-up.

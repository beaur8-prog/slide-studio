# Bullet-list continuation and consistent toggling

Publication update: included in [1.5.9](RELEASE-1.5.9.md). The local-only scope below records the earlier development turn.

The reported `One\nTwo` → bullets → Enter → `Three` sequence reproduced both failures before the fix: the new item had no marker, and toggling a mixed list inverted each line independently.

The Home button now decides one state for the entire text box. A mixed list becomes fully bulleted; a fully bulleted list becomes plain paragraphs. Existing literal bullets from earlier versions are recognized. Paragraph runs are transformed directly, retaining body fonts, colors, emphasis, spacing and imported soft breaks. Bullet metadata supplies hanging indentation and real PPTX bullet output.

Enter in a bulleted paragraph inserts its marker as part of one native editing operation, retaining caret formatting and native undo/redo. Shift+Enter and IME composition retain their normal handling. Imported numbered lists are outside this command's scope. Empty bullet bodies keep a visible caret font so the first typed characters cannot inherit the marker separator's zero font size.

## Verification

- Reproduced both reported failures in browser tests before changing production code.
- Six new regression cases cover continuation, repeated entries, splitting in the middle, mixed legacy lists, whole-box toggling while editing, empty bodies, Korean text, native and document undo, partial italic, save/reload, `.slide` serialization and PPTX export/import.
- The isolated native Mac app verified a newly inserted `One/Two/Three` list, all-off/all-on toggling, and typing into an initially empty bullet. The user's document was not used as a test fixture.
- Production TypeScript/Vite build passed. The staged Mac bundle passes strict ad-hoc signature verification; all ASAR source files match the production output.
- **36 tests passed**, no failures/skips (2.1 minutes), in one final run: bullet-list, paragraph-editing, text-format-selection, text-color-selection, release-editing and long-text suites. The production editing suite includes the previous text/shape/image numeric-input cases.
- The local app was confirmed saved with the user’s current six-slide document before normal quit for replacement; its IndexedDB is backed up locally.

## Scope

Git and the local Mac app only. Version remains 1.5.8. No public release, version tag, archive replacement or Lithos document change. The existing Mac ZIP, Windows ZIP/Setup and Linux DEB still match the published 1.5.8 hashes. Native Windows/Linux were not rerun for this local fix.

Local ASAR SHA-256: `c8b0fb518b03d831cab317711a4ef01670a02f0ec2e333733f7fd9b8bfa7fc56`.

Evidence is stored locally under `qa/results/bullet-list/` (ignored by Git).

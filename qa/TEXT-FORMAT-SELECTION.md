# Partial bold, italic and underline (local follow-up)

Home's formatting buttons previously blurred the editable text and patched the whole text box. The reported `Alpha Beta` → select `Beta` → Italic case failed the new regression test before the fix.

The buttons now preserve the editable selection and use Chromium's native formatting transaction. Only the changed character styles are synchronized back to the document, retaining other run properties and paragraph metrics. Native undo/redo and later typing use the same formatting history. Button state follows the selected text. A caret formats subsequent typing; object selection still formats the whole box. Underline is rendered on runs so an inherited underline can be removed from selected characters.

## Verification

- Final focused run: **36 passed**, no failures or skips (1.9 minutes). Covers 8 new formatting cases, existing color and context selection, paragraph editing/layout, and production asset/export coverage.
- Checks include partial italic, backward selection, removing inherited bold/italic/underline, caret typing, whole-object undo, keyboard italic, Korean text, paragraph spacing, unrelated font/color preservation, color/italic undo ordering, autosave/reload, and PPTX export/import.
- An initial Korean fixture was overwritten by the previous edit's pending autosave. The fixture now waits for saved state before loading its document; the complete final run passed.
- `npm run build` and `git diff --check` passed. The staged Mac bundle passes strict ad-hoc signature verification, and the installed copy has an identical ASAR. The Documents file provider reattaches FinderInfo attributes to the copied bundle, so strict verification is recorded against the staging bundle outside Documents; normal verification and actual launch of the installed copy pass.
- In an isolated native Mac test profile, entered `Alpha Beta`, selected `Beta` with the keyboard, and clicked Home Italic. The native selection remained `Beta`, only Beta visibly became italic, and native undo/redo worked. Evidence: `qa/results/text-format-selection/native-beta-italic.png`.
- Native Windows and Linux execution were not repeated for this source/local-app follow-up.

## Scope

Base version remains 1.5.7. Git and the local Mac app only; no release, version tag, public download replacement or Lithos update. Mac ZIP, Windows ZIP/Setup and Linux DEB retain their existing SHA-256 values. The local app was replaced only after confirming the user's five-slide document was saved and closing normally; its profile is preserved.

Local ASAR SHA-256: `79dc4c9e8836e66dca929d51d975a423db9fd98ebc804783dab1b732b942b7d0`.

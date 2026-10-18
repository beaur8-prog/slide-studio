# Preserve text selection in the context menu (unpublished local follow-up)

The previous correction ended editing to show the object menu, which removed the selected text range. The editor now keeps contenteditable mounted and snapshots its Range, selection direction and caret. Right-click default selection changes are prevented, and a CSS Custom Highlight retains the visible selection while menu buttons receive focus. Closing with Escape restores the exact range; an outside click ends editing without stealing focus from its target.

The text menu applies copy/cut/delete to selected characters, pastes at the saved range, and offers Select All. Text Box Menu explicitly changes to the whole-object commands. A narrow sender/frame-validated Electron IPC supports copy/cut/paste using webContents editing methods, keeping raw clipboard access and arbitrary commands out of the bridge.

## Verification

- 22 focused object-menu, text-selection, paragraph, Korean editor QA and native IPC cases passed in 44.0 seconds, with 0 failures/skips/flaky cases. A further multiline-range DOM-preservation case passed (23 confirmed cases total).
- Coverage includes right-clicking outside selected letters, visible highlight registration and cleanup, exact replacement after Escape, backward selection offsets, cut/copy limited to selected characters, caret paste, Select All/Delete, outside focus and autosave/reload, whole-object menu transition and existing undo/redo.
- Native IPC routing and untrusted senders/frames/invalid actions were checked for Mac and Windows mocks. The first new selection fixture omitted onMenu from its desktop mock and crashed before entering editing; after correcting that fixture, all four new cases and the expanded run passed.
- Production TypeScript/Vite build passed. The local Mac bundle's ASAR files match production sources, and its temporary signed bundle passed strict signature verification.
- In the actual user Mac app, only ‘더 나은’ was selected. Right-click displayed the text menu with the same blue selection. Escape kept the same selected text in the accessibility state. The document text was not changed. Screenshot: `qa/results/text-selection-menu/native-selection-preserved.jpg`.

## Scope

Git and local Mac app only, retaining the base version 1.5.4. No release/tag/public download or Lithos update was performed. The original published Mac ZIP, Windows ZIP and Setup files retain their recorded 1.5.4 SHA-256 values. Native Windows execution and actual system clipboard changes were not exercised in this follow-up; browser tests mock clipboard dispatch and native routing is covered separately.

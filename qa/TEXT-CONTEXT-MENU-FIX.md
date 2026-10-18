# Text editing context-menu correction (local follow-up)

The transaction-ending behavior described here was superseded by [selection preservation](TEXT-SELECTION-MENU-FIX.md), which keeps text editing and the selected characters active.

The user reproduced no response when right-clicking selected text in the text editor. The previous implementation bypassed app context-menu handling while contenteditable was active, assuming a default native text menu. Electron did not show one. The prior object-selection checks missed this state.

The canvas now handles context-menu events in either text state. It ends the active text transaction, preserves the entered text, and opens the text-box object menu. The contenteditable also allows Shift+F10 and ContextMenu key events to reach that handler. Escape is no longer a prerequisite.

## Verification

- A new regression reproduced the previous missing-menu failure before the fix.
- After the fix, 13 object-menu, paragraph-editing and editor QA checks passed, 0 failures or skips (36.2 seconds). They include actual right click during editing, preserved Korean text, undo/redo and Shift+F10.
- The production build passed. A local Mac app was rebuilt from current production sources, its ASAR source files compared, and its temporary bundle strictly signed/verified.
- In the actual user Mac app, the text was double-clicked into contenteditable, the selected text right-clicked, and the object menu visibly appeared. Original document text and slides were retained. The app is running with that menu open. Local evidence: `qa/results/text-context-fix/native-text-context.jpg`.

## Publication scope

Git and the local app only. No version tag or GitHub Release was created or edited. Existing Mac/Windows ZIP and Setup SHA-256 values still match the published 1.5.4 artifacts. The Lithos document and its share service were not changed. The local follow-up retains base version 1.5.4 until a release is requested; `release/BUILD-local.json` records its separate local ASAR. Native Windows execution was not repeated for this follow-up.

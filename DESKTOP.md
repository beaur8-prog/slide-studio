# Slide Studio desktop

The Windows shell now uses a 40px integrated title bar with native caption buttons. Its native menu stays installed for keyboard accelerators but is hidden by default. `desktop.platform` reports the platform; `desktop.setChromeTheme('dark' | 'light')` updates Windows caption colors through sender-validated IPC. The editor theme is saved locally and does not change slide colors. See [PowerPoint observation and validation](POWERPOINT-ANALYSIS.md).

Starting a slideshow (F5, Shift+F5, or a presentation button) automatically enters native fullscreen, covering the Windows taskbar. The slideshow has no floating control bar; click or use the arrow keys to navigate, and press Esc to restore the previous normal, maximized, or fullscreen editor state. `desktop.setPresentationMode(boolean)` validates the sender and argument; `onPresentationEnded` synchronizes native fullscreen exits with the renderer. Browser builds use the browser Fullscreen API. `tests/presentation-fullscreen.spec.ts` checks the real Windows window against the monitor bounds using an isolated profile, plus browser entry and exit.

The native application is generated at `release/Slide Studio.app`. Open it directly or drag it into Applications. The adjacent `Slide-Studio-mac-arm64.zip` is a portable copy for Apple Silicon Macs. The application is signed locally with an ad-hoc signature; it is not Apple notarized.

On Macs where Documents is managed by a File Provider, Finder may add metadata that causes strict signature verification of the copied `.app` to fail. The ZIP is created from the verified bundle before that copy; extract it into Applications for a clean install. Packaging also retains its verified temporary bundle, whose exact path is written to `release/BUILD.json` and printed by the build command.

The editor runs locally, with no account or PowerPoint installation required. File → Open reads `.slide` and `.pptx` files. File → Save exports the editable Slide Studio project; the Export commands write PowerPoint or PDF files. These commands use native dialogs. Files are limited to 256 MiB, with separate limits for expanded archive contents, images and objects. Autosave is stored in the app's local profile at `~/Library/Application Support/Slide Studio` on macOS or `%APPDATA%/Slide Studio` on Windows.

## Run and rebuild

```sh
npm ci
npm run build
npm start
```

For development, run `npm run dev` in one terminal and `npm run desktop` in another. Run `npm run package` on a Mac to rebuild the app and archive. The launcher and packaging script can reuse the Electron runtime already installed in the immediate parent workspace. If dependencies were installed with `--ignore-scripts` and neither runtime is available, install it using `node node_modules/electron/install.js` first.

Packaging requires `@electron/asar`, `sharp`, and standard macOS `codesign` and `ditto` tools. The script stages files in a temporary directory, bundles only the built editor and Electron shell, creates the original orange presentation icon, signs and verifies the bundle, and writes the results into `release/`.

The original orange artwork in `scripts/create-icon.cjs` also generates the committed `electron/assets/SlideStudio.png`. `npm run build` refreshes this PNG before bundling; regenerate it on its own with `node scripts/create-icon.cjs --runtime` after changing the artwork. The desktop shell explicitly applies it to the macOS Dock and window icon, so direct Electron and QA launches use the same artwork as packaged apps. Use the packaged `Slide Studio.app` when opening the final application for everyday use.

Slideshow right-click or F1 opens session pointer tools. `PresentationInk` keeps per-slide SVG ink separate from the deck, autosave, editor undo, and exports. Arrow mode preserves slide/web links; laser, pen, and stroke eraser modes consume pointer clicks, while keyboard and wheel navigation remain available. Ink coordinates follow the slide viewBox and survive navigation and scaling. Drawing uses pointer capture, cancellation, per-slide undo/redo, a bounded session, and clears when the show unmounts. The context panel supports colors and widths and closes before Escape can exit the show.

While native presentation mode is active, `before-input-event` intercepts Ctrl/Command+L/P/A/E/Z/Y before Electron Edit/Print accelerators consume them and routes `presentation-*` actions through the existing main-to-renderer menu channel. Editor accelerators remain unchanged outside presentation mode. The Print menu action selects the pen during a show. [1.5.3 checks](qa/RELEASE-1.5.3.md) include actual Windows installed-app coverage.

## Native integration

`src/desktop.d.ts` describes the optional `window.desktop` bridge: `saveFile`, `openFile`, `exportPDF`, `print`, and `onMenu`. Menu actions are `new`, `open`, `save`, `export-pptx`, `export-pdf`, `print`, and `present`. Returning `null` from a file method means the user cancelled the dialog; failures reject the promise. Printing returns `true` for submission and `false` for cancellation. A registered printer is required; on a Mac with no printers, Electron rejects the operation before opening the print dialog. PDF export works without a printer.

PDF export prints the renderer's `@media print` layout. The editor should supply one page per slide and `@page { size: 13.333333in 7.5in; margin: 0; }`. The main process waits for fonts and prints backgrounds. Renderer `beforeunload` protection is respected through a native Keep Editing / Close Without Saving dialog.

The renderer has Node.js disabled, context isolation and Chromium sandboxing enabled, a restrictive content security policy, and no general filesystem or shell bridge. IPC checks the window, main frame, and loaded document. File writes are atomic and go only to a path chosen in the native dialog. Browser navigation, embedded webviews, permissions, and downloads are blocked. A real user click on an HTTP or HTTPS link may open the system browser through an isolated preload handler.

Electron's license and Chromium notices are included in the application bundle's Resources directory. Slide Studio is an independent application and is not affiliated with Microsoft.

## Windows packaging

`npm run package:win` downloads the official Windows x64 Electron runtime, verifies its published SHA-256, and creates both `release/Slide-Studio-win-x64.zip` and the primary download, `release/Slide-Studio-Setup-x64.exe`. The portable ZIP is retained for existing download links and as the verified input to the installer. Both contain the same production ASAR as the Mac app. The Setup package omits the portable ZIP's extraction-only `시작하기.txt`.

Setup installs for the current user in `%LOCALAPPDATA%\Programs\Slide Studio` with `asInvoker` privileges. It creates Start menu shortcuts, an optional desktop shortcut, and an Apps & features uninstall entry under HKCU. Save and close the app before updating; a running executable blocks installation rather than being forcibly terminated. The uninstaller deletes only the generated list of app files and empty directories, preserving `%APPDATA%\Slide Studio`, saved documents, and unrelated files. The installation root is fixed; `/D=` cannot redirect installation or uninstallation to an arbitrary directory. This release does not add file associations or automatic updates.

Building Setup requires NSIS 3.x (`makensis`) and 7-Zip (`7zz` or `7z`). On macOS, run `brew install makensis sevenzip`. On Windows, install NSIS and 7-Zip or set `MAKENSIS` and `SEVENZIP` to their executable paths. `npm run package:win:setup` rebuilds just the installer from the ZIP and `BUILD-win-x64.json`, after checking their version, size, SHA-256, and CRC32. The packager compiles a Unicode English/Korean wizard, checks the installer version/icon/privilege manifest, tests and extracts it with 7-Zip, and compares every installed payload file's SHA-256. It writes `release/BUILD-win-setup-x64.json` and `SETUP-PAYLOAD.json`.

The manually dispatched [Windows installer workflow](.github/workflows/windows-installer.yml) downloads the exact release files, checks their supplied SHA-256 values, and uses a disposable Windows runner to install, launch the packaged app, reject an update while the app is open, reinstall, and uninstall. It checks installed file hashes, shortcut targets, HKCU registration, and preservation of user data and unrelated files. `scripts/qa-windows-setup.ps1` refuses to run outside Windows CI or over a pre-existing installation/profile. See [1.5.3 verification](qa/RELEASE-1.5.3.md) for current installed-app pointer and ribbon checks and [1.5.2 Setup verification](qa/SETUP-1.5.2.md) for the installer introduction. Cross-packaging metadata intentionally retains `nativeWindowsInstall: false`; the separate CI record documents actual execution. The installer is unsigned. Actual keyboard IME typing and physical printer output remain untested. See [1.5.3 app checks](qa/RELEASE-1.5.3.md) for the current presentation tools and regression results.

## Object context menu (1.5.4)

The editing-text context-menu correction below is a source/local-app follow-up; it has not been published in a new release.

Right-clicking a canvas object selects it, or preserves a multi-selection containing it, then opens the editor menu. Actions reuse existing document operations and undo history: cut/copy/paste, duplicate/delete, layer order, lock/unlock and inspector. Text objects also offer text editing and tables offer table editing. Locked objects disable destructive commands. Right-click or Shift+F10 while editing text keeps the contenteditable mounted and opens the text-selection menu. The DOM Range, backward-selection direction and caret position are preserved; a CSS Custom Highlight keeps the selected letters visible while the menu has focus. Escape restores focus and the same selection. Cut/copy/delete apply to selected characters, paste uses the saved range, and selecting Text Box Menu explicitly ends editing and opens the whole-object menu. Electron has no default text context menu; editing must not bypass the app menu. The sender-validated `edit-text-clipboard` IPC accepts only copy/cut/paste and routes to the existing webContents editing methods; no raw clipboard read or general command execution is exposed. Shift+F10 and the context-menu key open the object menu; arrows/Home/End, Enter and Escape support keyboard use. The menu clamps to the viewport and dismisses on outside input, window resize/blur, slide change, dialog or presentation entry.

## Selected-text color palette (unpublished local follow-up)

Home's Font Color control and the editing-text context menu open the same palette. A cloned DOM Range survives Home tab changes and palette focus, with a CSS Custom Highlight for the source letters. Swatches, a custom color input and hex text update a draft; only Apply changes the document. Cancel/Escape restore the range, and outside input cancels without stealing focus. A caret-only palette cannot accidentally recolor the whole text box. Whole-object selection explicitly applies to the entire selected text box.

Selected-text Apply uses Chromium's native foreground-color edit command so selection and native undo/redo remain available. The input handler maps computed colors from a single detached DOM clone back onto typed paragraph/run ranges; only those colors are serialized, preserving run typography, paragraph metrics, soft breaks and blank lines. Subsequent edits and native undo/redo keep that color model synchronized. No arbitrary editor HTML is persisted. [Verification](qa/TEXT-COLOR-SELECTION.md).

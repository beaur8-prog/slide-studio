# Slide Studio desktop

The Windows shell now uses a 40px integrated title bar with native caption buttons. Its native menu stays installed for keyboard accelerators but is hidden by default. `desktop.platform` reports the platform; `desktop.setChromeTheme('dark' | 'light')` updates Windows caption colors through sender-validated IPC. The editor theme is saved locally and does not change slide colors. See [PowerPoint observation and validation](POWERPOINT-ANALYSIS.md).

Starting a slideshow (F5, Shift+F5, or a presentation button) automatically enters native fullscreen, covering the Windows taskbar. Esc or the presentation exit button restores the previous normal, maximized, or fullscreen editor state. `desktop.setPresentationMode(boolean)` validates the sender and argument; `onPresentationEnded` synchronizes native fullscreen exits with the renderer. Browser builds use the browser Fullscreen API. `tests/presentation-fullscreen.spec.ts` checks the real Windows window against the monitor bounds using an isolated profile, plus browser entry and exit.

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

## Native integration

`src/desktop.d.ts` describes the optional `window.desktop` bridge: `saveFile`, `openFile`, `exportPDF`, `print`, and `onMenu`. Menu actions are `new`, `open`, `save`, `export-pptx`, `export-pdf`, `print`, and `present`. Returning `null` from a file method means the user cancelled the dialog; failures reject the promise. Printing returns `true` for submission and `false` for cancellation. A registered printer is required; on a Mac with no printers, Electron rejects the operation before opening the print dialog. PDF export works without a printer.

PDF export prints the renderer's `@media print` layout. The editor should supply one page per slide and `@page { size: 13.333333in 7.5in; margin: 0; }`. The main process waits for fonts and prints backgrounds. Renderer `beforeunload` protection is respected through a native Keep Editing / Close Without Saving dialog.

The renderer has Node.js disabled, context isolation and Chromium sandboxing enabled, a restrictive content security policy, and no general filesystem or shell bridge. IPC checks the window, main frame, and loaded document. File writes are atomic and go only to a path chosen in the native dialog. Browser navigation, embedded webviews, permissions, and downloads are blocked. A real user click on an HTTP or HTTPS link may open the system browser through an isolated preload handler.

Electron's license and Chromium notices are included in the application bundle's Resources directory. Slide Studio is an independent application and is not affiliated with Microsoft.

## Windows packaging

`npm run package:win` downloads the official Windows x64 Electron runtime and verifies its published SHA-256. It creates `release/Slide-Studio-win-x64.zip` with the executable, runtime files, licenses and the same application ASAR used on macOS. The entire folder must be extracted before running `Slide Studio.exe`. The packager can run on macOS; cross-packaging does not verify native Windows execution. This working copy was launched on Windows on 2026-10-17 and its native window controls and rendered editor were inspected. The packager's `nativeWindowsExecution: false` field describes packaging-only checks; it does not incorporate subsequent manual execution. This build is unsigned. Actual Windows IME settings and physical printer output remain untested.

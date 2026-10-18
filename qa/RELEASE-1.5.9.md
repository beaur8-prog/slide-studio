# Slide Studio 1.5.9

This release includes bullet-list continuation and consistent whole-box toggling from `91d75c7`, including visible typing into empty bullet bodies. Windows download and SmartScreen installation warnings are now explained in the README and the existing Lithos download guide.

## Regression checks

**37 passed, no failures/skips (2.3 minutes).** Relevant suites cover bullet lists, paragraph editing, partial formatting and color, long Korean text, the previous seven-slide numeric-input cases and production font/PPTX loading. These are the checks run for this release; the previous full 197-test regression result remains in [1.5.8](RELEASE-1.5.8.md).

The shared installed-app check now opens a separate list fixture and verifies `One/Two` → Enter → `Three`, all-off/all-on toggling and three markers after reload. Native Windows and Ubuntu results are added after verification, before promoting the release to stable latest.

TypeScript/Vite build and `git diff --check` passed. The packaged Mac app reports 1.5.9, and the existing six-slide user document reopened with its saved text and notes intact. Its IndexedDB was backed up before normal app shutdown.

## Distribution

Mac ARM64 ZIP, Windows x64 Setup/portable ZIP and Linux amd64 DEB are built from the same source. Package hashes and native OS results will be recorded here when verification completes.

The public download-guide URL and stable binary URLs are retained. The guide documents browser download warnings and the Windows **More info → Run anyway** flow for a verified copy downloaded from the linked repository. Company policy and Smart App Control may prevent that option. Malware detections are distinct from unsigned/unknown-reputation warnings.

Mac is not Apple-notarized; Windows has no release code signature. Linux is a standalone unsigned DEB. Native Windows CI uses Windows Server 2025, not a physical Windows 10/11 device. Browser reputation warnings and SmartScreen UI are not reproduced by the automated installer checks. Physical Windows/Linux IME typing, Wayland, screen-capture permissions and paper printing are outside this release check.

Local evidence: `qa/results/release-1.5.9/` (ignored by Git).

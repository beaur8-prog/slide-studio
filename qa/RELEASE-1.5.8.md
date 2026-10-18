# Slide Studio 1.5.8

This release fixes partial text formatting and numeric inputs that changed values while the user was still typing.

- Selecting only “Beta” in “Alpha Beta” and clicking Home Italic formats only Beta, preserving the selection and native undo/redo. Bold and underline use the same selection-preserving path.
- Width, height, rotation and other inspector fields, plus Home font size, keep the complete draft until Enter or blur. Escape cancels. Minimum/maximum bounds apply only at commit.
- Text, shape and image checks cover width 200, height 200, rotation −15 and text font size 24 in seven-slide documents, with reload persistence and an untouched first slide.

## Regression suite

**197 passed, 2 environment-dependent skips, 0 failed (7.1 minutes).** Coverage includes both reported defects, saved projects and PPTX round trips, long Korean text, tables, clipboard/context menus, wheel navigation and presentation tools. The skipped checks require native Windows fullscreen or an unavailable local Office Light font.

## Build and package checks

- TypeScript/Vite production build and `git diff --check` passed.
- All 48 `dist`/`electron` files match the Mac production ASAR, with version metadata 1.5.8. Mac ZIP, Windows ZIP/Setup and Linux DEB share the same ASAR (`204ba7903a59cb73093260e565618a781af2c32474bcf52e10aec99dc92feaa6`).
- Both ZIP CRC scans passed. The extracted Mac app passes strict ad-hoc signature verification and has the expected icon/version.
- Windows Setup integrity, per-user manifest, icon/version resources and all 76 extracted payload files passed verification against the portable ZIP.
- Linux official-runtime checksum, ZIP CRC, ELF x64, DEB readback, payload hashes and root-owned sandbox helper mode 4755 passed.
- The local Mac app was reopened as 1.5.8; the user's existing five-slide document and saved state remained intact. The version dialog and retained document were checked through the native UI.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |

| Slide-Studio-mac-arm64.zip | 129643625 | `7407b2afbdbb8df3543e29979b904823f66752aed825cd3b01cb86da555dfa82` |
| Slide-Studio-win-x64.zip | 156816541 | `955283bdd2f3c5709cec6e006299b68addfb381efe5f6f17857e2abe2a17f3ae` |
| Slide-Studio-Setup-x64.exe | 109509714 | `52571711dcec3b23d7ea640999b8175a161acec47aef112df99d38b4b5ea80aa` |
| Slide-Studio-linux-amd64.deb | 132309022 | `6332592ad5cbb4d197fa7680b479847eeebecc2ae6ea4725c9addc94b0797ca1` |

## Native OS and public verification

[Windows CI](https://github.com/beaur8-prog/slide-studio/actions/runs/39109602113) passed clean install, installed payload hashes, shortcuts/registration, installed-app editing tests, in-place reinstall, uninstall and user-profile/unrelated-file preservation. The exact reported partial-italic and numeric-input cases passed in the installed app, including seven slides, all three object types and reload persistence.

[Linux CI](https://github.com/beaur8-prog/slide-studio/actions/runs/39110056431) passed on Ubuntu 22.04 and 24.04: install, shared libraries, desktop entries, sandbox ownership, installed payload hashes, real app editing checks, reinstall, uninstall and profile/unrelated-file preservation. Both installed-app runs passed partial italic/selection/undo/redo, exact numeric edits on text/shapes/images and reload persistence. Korean system fonts, PPTX import, long text, chart notice, presentation tools and native PDF export also passed, with Chromium sandbox enabled.

Version `v1.5.8` is the stable latest GitHub release. Source tag: `c10faf9d999f01a9f3ec75162acd3d602efc7174`; the subsequent QA-only commits do not change runtime files. The existing Lithos guide was updated through the running service's `ShareServer.update`. Its URL, token, creation/expiry, source/vault identity, server PID/port and tunnel PID/origin stayed unchanged. The public page visibly shows 1.5.8, OS-warning text, platform downloads and new editing instructions with nine screenshots.

The initial Linux font check queried the outer `.element-text` wrapper, which reports no fonts after the inline-formatting change added a nested span. A local Chromium diagnostic reproduced this: the wrapper returns an empty font list while its text-bearing span returns the real Latin and Korean fonts. Commit `4eba9c1` corrects the QA selector and retains the same Noto CJK glyph assertion. It changes only the verification script; the published DEB and runtime hashes are unchanged. A subsequent QA-only change (`27d02b7`) waits for the autosave scheduled by reload before closing the native app, avoiding the intentional unsaved-work confirmation. The shared regression check passed again after that harness change.

Mac is not Apple-notarized; Windows has no release code signature. Linux is a standalone unsigned DEB. Physical keyboard IME typing on Windows/Linux, Wayland, actual screen-recording permissions and paper printing are outside this release check. Windows CI uses Windows Server 2025; supported end-user Windows versions remain 10/11 x64.

## Final public verification

All five stable download URLs were fetched in full and match the local file sizes/SHA-256 values, redirecting to v1.5.8. GitHub asset digests also match. The public guide body matches the reviewed source, all nine screenshot assets match byte-for-byte, and all previous download URLs are unchanged. The existing sharing server and tunnel remain running without restart; the temporary local maintenance inspector was closed.

[Unchanged download and usage guide](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) · [GitHub release](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.5.8)

Local evidence is under ignored `qa/results/release-1.5.8/`: regression logs, package/source verification, native Windows/Ubuntu artifacts, public download hashes, share state before/after and the rendered document screenshot. Mac screenshots verify the version dialog and preservation of the original five-slide document.

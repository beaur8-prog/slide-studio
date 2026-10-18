# Slide Studio 1.5.9

This release includes bullet-list continuation and consistent whole-box toggling from `91d75c7`, including visible typing into empty bullet bodies. Windows download and SmartScreen installation warnings are now explained in the README and the existing Lithos download guide.

## Regression checks

**37 passed, no failures/skips (2.3 minutes).** Relevant suites cover bullet lists, paragraph editing, partial formatting and color, long Korean text, the previous seven-slide numeric-input cases and production font/PPTX loading. These are the checks run for this release; the previous full 197-test regression result remains in [1.5.8](RELEASE-1.5.8.md).

The shared installed-app check now opens a separate list fixture and verifies `One/Two` → Enter → `Three`, all-off/all-on toggling and three markers after reload. The same scenarios passed in the installed Windows and Ubuntu apps.

TypeScript/Vite build and `git diff --check` passed. The packaged Mac app reports 1.5.9, and the existing six-slide user document reopened with its saved text and notes intact. Its IndexedDB was backed up before normal app shutdown.

## Distribution

Mac ARM64 ZIP, Windows x64 Setup/portable ZIP and Linux amd64 DEB contain the same ASAR (`d420c933ed2c0e8813bc6e53d9a899a0fcc4cae2128bb24d70babb86fa462db0`). All 48 production source files match. ZIP CRC scans, extracted Mac strict ad-hoc signature, icon/version, all 76 Windows Setup payload files, and DEB payload/sandbox-helper checks passed.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129644184 | `9cf71a44fa1d6cc4f31ad642d1794a814dbdcb734267565356f76352fee0e3e6` |
| Slide-Studio-win-x64.zip | 156817097 | `0be1920168d0b2ee1c350ca2714c1b0e01e3e44412a459a92bbc077d6f743d47` |
| Slide-Studio-Setup-x64.exe | 109584426 | `0ae191636d396c888302cd3a1ac80ecbb71ca62bb82bda21331bd4ecd05b4f53` |
| Slide-Studio-linux-amd64.deb | 132310024 | `87a20881d13598b7ec38c3cd9c442e800b936ad56179c892ef12832f5e4ac69f` |

[Windows installed-app verification](https://github.com/beaur8-prog/slide-studio/actions/runs/39114538011) passed install, editing, reinstall, uninstall and user-profile preservation. [Ubuntu 22.04/24.04 verification](https://github.com/beaur8-prog/slide-studio/actions/runs/39114539970) passed the equivalent checks with sandbox protection enabled. Both include the new list checks, partial italic and numeric-input regression checks; Linux also verifies Korean system fonts, PPTX input and PDF export.

Source tag `v1.5.9` points to `2098ad6b9c5c7dfb6435dc27bfd1f48e6b4e3550`. Subsequent release-record edits do not change the runtime.

The public download-guide URL and stable binary URLs are retained. The guide documents browser download warnings and the Windows **More info → Run anyway** flow for a verified copy downloaded from the linked repository. Company policy and Smart App Control may prevent that option. Malware detections are distinct from unsigned/unknown-reputation warnings.

Mac is not Apple-notarized; Windows has no release code signature. Linux is a standalone unsigned DEB. Native Windows CI uses Windows Server 2025, not a physical Windows 10/11 device. Browser reputation warnings and SmartScreen UI are not reproduced by the automated installer checks. Physical Windows/Linux IME typing, Wayland, screen-capture permissions and paper printing are outside this release check.

Local evidence: `qa/results/release-1.5.9/` (ignored by Git).

## Final publication verification

Version `v1.5.9` is the stable latest GitHub release. All five stable download URLs were fetched in full; their bytes and SHA-256 values match the local packages and GitHub asset digests. The existing Lithos guide now shows 1.5.9, the browser download warning and **추가 정보 → 실행** installation instructions. Ten public images match their reviewed files.

The shared document URL, token, source/vault identity, creation/expiry values, server PID/port and tunnel PID/origin are unchanged. The guide was refreshed through the running service's `ShareServer.update`, without restarting either service. A rendered Markdown emphasis correction was applied through the same update operation. The temporary localhost maintenance inspector was closed after both updates.

[Unchanged download and usage guide](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6) · [GitHub release](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.5.9)

Evidence includes `publication-verification.json`, native OS artifacts, the retained user's six-slide Mac document/version check and `download-warning-guide.png` under the ignored evidence directory.

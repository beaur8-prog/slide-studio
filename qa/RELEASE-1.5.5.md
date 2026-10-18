# Slide Studio 1.5.5 candidate verification

**Withdrawn before becoming the latest public download.** Native Windows
evidence exposed a plain-text partial-color layout defect missed by the
paragraph-based fixtures. The candidate is a private draft; the final fix and
release are recorded in [1.5.6](RELEASE-1.5.6.md).

This release includes text context selection preservation, partial text color
with Apply/Cancel, source-font import/persistence/removal, Office-private Calibri
discovery, and consistent Unicode fallback metrics. It also includes the 1.5.4
object editing, presentation tools and unclipped ribbon labels.

## Regression verification

- Production TypeScript/Vite build passed.
- Across the full run and targeted rechecks, **167 passed, 2 skipped,
  0 unresolved failures**. The original full run had 161 passes and 6 failures:
  five result/trace writes failed with ENOSPC during concurrent packaging, and
  one burst fixture's nominal 30 ms timer was actually delayed to about 94 ms,
  beyond the app's 80 ms quiet gap. Obsolete generated builds were removed,
  leaving user documents/profiles intact; all five resource failures passed.
  The burst fixture now dispatches queued events together in one browser task.
  Its separate timed momentum-tail and distinct-notch checks remain in place.
  The final wheel/presentation run passed all 13 cases. App wheel logic was not
  changed to accommodate the test fixture.
- Skips require a real Arial Nova Light cache and native Windows fullscreen.
  The installed Windows check below is separate from the Mac/browser suite.
- Coverage includes public PPTX layouts/paragraph advances, Korean and mixed
  scripts, source font selection and restart, partial color/undo/roundtrip,
  text and object context menus, tables, memory retention, file transport,
  wheel navigation and presentation ink.
- Raw results are in `qa/results/release-1.5.5/` (ignored build/test outputs).

## Package integrity

Both ZIPs pass complete CRC checks and share ASAR
`86981e7ee87f9687d3c8e30ed2c7d638813d87a80e3fa933b65d287e34d86f97`.
All 49 production files in each ASAR match the current dist/electron sources
and production-only package metadata. The extracted Mac ZIP passes strict
signature verification and the 1.5.5 version/icon checks. Setup extraction
verifies all 76 payload files, executable/version resources and per-user
manifest. The first Setup attempt ran out of disk space; rebuilding after
removing known temporary build copies succeeded. No partial package is used.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129641989 | `e8bf6776312366845c050b95f4deff2e725d840d2657287cadd95a7f28ba4361` |
| Slide-Studio-win-x64.zip | 156814904 | `2f878ec4f43ecd0a5369e45cf288f307a71d736d13ac93a6f5c3babe85d08ba8` |
| Slide-Studio-Setup-x64.exe | 109487303 | `6aecfb12084492feb7cf5b2c8aa373a5a5e1297d5f66ccb20e8ae4919fb1c66d` |

## Native applications

The rebuilt Mac app launches as 1.5.5 and restores the user's five-slide saved
document. The Windows installer run is verified before making this the latest
public download; its result and run link are recorded here after completion.

Physical Windows 10/11 devices, direct OS IME typing, real screen-recording
permissions and paper printing are not claimed by these automated checks.
Original Calibri is absent on this Mac; source-font selection tests use a
clearly identified test fixture and do not claim exact Calibri measurements.

## Publication

Download asset names remain fixed so existing `/releases/latest/download/`
links continue to work. The Lithos source is the existing integrated download
and usage document. Refresh uses the live ShareServer.update operation; no
server/tunnel restart, new share, token change or source identity change is
required. Final public download hashes and live document identity are checked
after publishing.

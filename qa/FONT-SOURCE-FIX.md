# Source fonts and consistent Calibri fallback (local follow-up)

The user asked to reduce wrapping differences caused by replacing Calibri with
Carlito. Installed originals already had priority, but Office-private Calibri
faces were unavailable to Chromium, and the calibrated aliases covered Latin
only. Other supported scripts could use unrelated system fonts.

## Changes

- Use existing Office-private Calibri/Calibri Light regular, bold and italic
  faces from fixed Windows/macOS cache locations and macOS Office resources.
  Exact PostScript names and weights, bounded reads, trusted argument-free IPC
  and path containment checks keep this optional lookup narrow.
- Add **파일 → 원본 글꼴 추가** for individual TTF/OTF source faces. Read family,
  localized family names, weight and italics from bounded OpenType metadata;
  validate with FontFace before storing. Restore added faces before the first
  slide on restart. Removal restores the normal fallback. Device-local storage
  is separate from documents; font bytes do not enter project/PPTX exports.
- Apply the established Calibri/Calibri Light fallback metrics to all seven
  Fontsource subsets, including extended Latin, Greek, Cyrillic and Vietnamese.
  Actual original faces bypass those substitute-only adjustments.
- Preserve the source font names/sizes and existing text editing behavior.

## Verification

- 42 relevant checks passed, 1 skipped. The first run covered fonts, local font
  import/persistence/removal, Office cache fixtures, paragraph layout, wrapping
  and partial color (27 passed, 1 skipped). Object menus, preserved selections
  and native IPC checks added 15 passes. After localized-name support, all 11
  applicable font/IPC checks passed again (1 skipped); the 3 font checks passed
  again after adding explicit Korean-name assertions.
- Chromium's selected PostScript face proves that adding a face replaces
  Carlito, persists after reload, and removing it restores Carlito. This test
  uses a renamed bundled Nanum font solely as a test fixture, not as a Calibri
  metric reference. The current Mac has no original Calibri/Office light face;
  the skipped case requires actual cached Arial Nova Light. Windows paths and
  IPC are tested with fixtures/mocks, not a fresh native Windows installation.
- Existing CMU slide 34 PDF width/line checks and paragraph advances still pass.
  Unicode samples retain the established 0.988 Light/Regular size ratio.
- Production TypeScript/Vite build passed. The prepared Mac bundle passed strict
  ad-hoc signature verification and ASAR/source equality checks. Its ASAR hash is
  `dac004f0b86e3503ba7492fb90f91f1216ab227ec39536eb2b19a4ff1e8d6a3d`.
- The device's File Provider attaches FinderInfo to helper bundles copied under
  Documents, causing strict verification of that local copy to reject metadata.
  The temporary prepared bundle passed strict verification; the installed local
  ASAR matches it. The copied app launches normally.
- The user's existing five-slide document was saved, normally quit and restored
  in the updated `release/Slide Studio.app`. The new font dialog was opened in
  the native app; no fonts or document content were changed in that user session.
  Local proof: `qa/results/font-source-fix/native-font-manager.jpg` and
  `qa/results/font-source-fix/local-build.json`.
- All three existing public ZIP/Setup hashes are unchanged. No release, tag,
  download replacement or Lithos edit was performed. Base version stays 1.5.4.

## Limits

An absent original font cannot be reconstructed from its name. Add the original
face on each viewing computer to avoid substitution. PowerPoint-specific
shaping/layout can still differ even with the same face. No claim of exact
Calibri rendering without Calibri is made. See [FONT_NOTES.md](../FONT_NOTES.md).

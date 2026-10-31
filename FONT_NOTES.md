# Font matching in Slide Studio

Installed source fonts are first in every font stack. The app does not install or
redistribute Microsoft fonts. Source names and point sizes stay in the editable
model and exported PPTX; substitute names and metric adjustments are only used
when rendering in Slide Studio.

## Document font diagnosis (development 1.6.18)

**File → 원본 글꼴 추가 → 이 문서의 사용 글꼴** lists source families used in
actual text and table cells and whether the app can use them or needs a fallback.
Korean/English family aliases are tried before substitution. **다시 확인** clears
the bounded availability cache after fonts are added during the session. The
check is cancellable, ignores results for a replaced document and has bounded
concurrency/timeouts; it never downloads fonts or changes the document/Undo state.
This is a family-level diagnosis, not proof that every weight, style or character
uses the same original face. A family with “Medium” in its name can be visually
heavier than its substitute even when the source has no explicit bold property.

## Bundled fonts and provenance

- **Carlito**, unchanged Fontsource 5.3.0 files, is the Calibri substitute.
  [Project and OFL](https://github.com/googlefonts/carlito).
- **Nanum Barun Gothic**, unchanged Regular, Bold and Light TTF files, is included
  for `나눔바른고딕` / `NanumBarunGothic` names.
  [NAVER font collection](https://hangeul.naver.com/fonts/search?f=nanum),
  [official archive](https://hangeul.naver.com/hangeul_static/webfont/zips/nanum-barun-gothic.zip),
  [redistribution terms](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko).
  The exact source archive is retained in `qa/results/fonts-before/`.
- License texts ship in `dist/licenses/`; font assets ship inside the app for
  offline editing, presentation, PDF and print.

| Nanum file | SHA-256 |
| --- | --- |
| NanumBarunGothic.ttf | 9b872773134e2e4d8c0b17021266786576db06c843ede0d0b523b214a450756c |
| NanumBarunGothicBold.ttf | 39bba4cd9bd2986143825c8654abbb62443914ab33b346c0c929a916f5d98bf2 |
| NanumBarunGothicLight.ttf | 741c050acf9673158b6e5c9c863d05c9ee0f56cc77cf7e3d7a2ae0ee6502c3a4 |

## Metrics and source text properties

The CSS aliases use Calibri's 1536/-512/452 ascent/descent/line-gap metrics at
2048 units per em (75%, 25%, 22.0703125%). This avoids substituting the newer
Carlito build's different vertical metrics. The upstream compatibility issue
records the differing tables: [google/fonts #9720](https://github.com/google/fonts/issues/9720).

Calibri Light uses a separate Carlito-based fallback with `size-adjust: 98.8%`.
This is an approximation calibrated against twelve text lines from the public
CMU lecture 3, slide 34 PDF, not a true Calibri Light face. The known overflowing
phrase measured 305.52 px before and 301.84 px after; the PDF advance is 301.99 px
at the same 96 px/in scale. It now fits its original 302.74 px inner box in one
line. A separate six-page, 27-line comparison outside this calibration page reduced mean absolute relative width error from 1.24% to 0.23% (integer PDF bounds, single-style Calibri Light text of at least ten characters). The source font size stays 20 pt. Carlito still has heavier strokes than
Calibri Light. The adjustment never applies when the original font is installed.

Latin and East Asian font declarations inherit separately. Display spans are
split by script, while the two source faces stay on the original model run for
editing and export. The theme's Hang/Jpan/Hans/Hant face follows the run's script
and language. Character spacing (`spc`), kerning threshold (`kern`), language,
default tab size and Latin word-break / East Asian line-break flags are retained.
CSS strict line breaking approximates the East Asian punctuation rules; this is
not a full implementation of PowerPoint's configurable kinsoku rules.

Group transforms apply to box geometry. Authored point sizes and text spacing
are not multiplied again by the group's extent ratio. The CMU slide 34 grouped
labels are consequently 20 pt, matching the source XML and PDF, instead of
28.36 pt. User-initiated deck resizing still scales the model's text explicitly.

References: [Office paragraph rules](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/9b34280e-538e-4811-8af9-761d34f88f20),
[Office text-run inheritance / kerning](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/4823e093-d57b-4b05-91a6-4858174d8b64).

## Windows Office light-font cache

The Windows desktop app can use an **existing Arial Nova Light** face from
`%LOCALAPPDATA%/Microsoft/FontCache/<version>/CloudFonts/Arial Nova/`. PowerPoint
uses this Office-private face to substitute `Helvetica Light` in the public CMU
lecture 4 presentation. Chromium otherwise resolves Windows' `Helvetica` alias
to regular Arial, which makes the same text visibly heavier.

At startup, a trusted, argument-free desktop IPC request checks only this named
cache directory. It accepts a bounded TrueType file only when its PostScript
name is `ArialNova-Light` and its weight is 300. Cache-version/file counts and
font size are limited; paths escaping the cache through links are rejected.
The renderer registers the returned bytes in memory as
`Slide Studio Office Arial Nova Light`. This face is used after the original
`Helvetica Light` and `Helvetica Neue` names, before the Windows `Helvetica`
alias. Bold runs retain the previous system-font stack. The Calibri support
described below is a separate change in version 1.5.6.

The app does not download, install, copy into its package, or redistribute this
Office font. No Windows font-registration or Office settings are changed.
If Office has not cached the face, if the cache is unavailable, or if validation
fails, startup continues using the existing fallback stack. Browsers also keep
the existing stack. The editable model and exported PPTX retain the source font
name; exported PPTX files do not embed the cached font.

The Windows font regression test checks the real selected face through Chromium
and compares the CMU4 title's width with the native PowerPoint PDF. The corpus
runner's `--office-fonts` option explicitly loads the same optional cache face
for desktop-equivalent screenshots; it records whether loading succeeded.

## Remaining differences

Malgun Gothic is normally available on Windows but is absent on the Mac used
for the 1.4.0 release checks. Its Apple SD Gothic Neo fallback has different
advances: the DSU slide 10 labels remain complete and contained in two lines,
but the exact break positions differ from the Windows reference. The regression
test checks text preservation, line count and bounds on every platform, and
checks the reference break positions when Malgun Gothic is actually installed.
The hanging-punctuation test also measures the renderer's complete font stack
instead of measuring an unavailable Windows face in isolation. These changes
make the tests portable; they do not eliminate source-font substitution.

Uninstalled commercial faces such as HY나무M, HY바다M and Sandoll fonts still use
local substitutes. Light-face shape/thickness, advanced typography, custom tab
stops, full script-specific punctuation rules and PowerPoint's layout engine can
still differ. PPTX exports reference fonts by name; they do not embed font files.
The font assets included in Slide Studio do not automatically travel with a PPTX.

## Local source-font support (1.5.6)

The renderer now tries an installed source family, a user-added source face,
then an existing Office-private Calibri face before the Carlito substitute.
Calibri and Calibri Light styles are registered separately with their actual
weights and italics; original faces do not receive Carlito's size/vertical
adjustments. Startup loads saved faces before the first slide is rendered.

**File → 원본 글꼴 추가** accepts TTF/OTF files and TTC/OTC collections in the current source build. The app reads their
family (including localized Korean names), weight and italic metadata and validates them with Chromium's FontFace
loader. Add the regular/bold/italic files needed by the document. Faces are
stored in a separate local IndexedDB database and restored on restart; removing
a face restores normal font fallback. Limits are 64 MiB per file, 24 faces and
256 MiB total. Fonts are neither installed in the OS nor sent over the network,
embedded in `.slide`/PPTX exports, or added to public installers. Each viewing
PC needs its own source fonts. Collection faces are extracted into bounded standalone sfnt files, with relocated table offsets and recomputed checksums. Every face must load successfully before the collection is stored; no operating-system fonts are changed.

Optional automatic Calibri discovery checks fixed Office FontCache locations on
Windows and macOS, plus the font resources in installed macOS PowerPoint, Word
and Excel apps. Each file must have an exact whitelisted Calibri PostScript
name/weight. Reads are bounded and links escaping the expected directories are
rejected. Missing/unreadable fonts never stop the editor from opening. This
uses only files already on the device; it does not download Microsoft fonts.
The existing Arial Nova Light path remains available on Windows.

Carlito's calibrated Calibri/Calibri Light aliases now cover all seven supplied
Fontsource Unicode subsets, including extended Latin, Greek, Cyrillic and
Vietnamese, with consistent size and vertical metrics. Previously those aliases
included only Latin, so other supported characters could fall through to a
system font with different widths. Regenerate the CSS after a Fontsource update
with `node scripts/create-font-fallbacks.cjs`.

These changes remove avoidable font substitution when the source face is
available; they cannot reconstruct a missing commercial font or guarantee an
identical PowerPoint layout engine. The current Mac has no original Calibri.
Tests use a clearly named, test-only Nanum fixture to prove font selection,
persistence and removal, not as a reference for Calibri's real metrics. Existing
CMU PDF width/line and paragraph regressions still test the bundled fallback.

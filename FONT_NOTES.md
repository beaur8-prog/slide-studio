# Font matching in Slide Studio 1.2.1

Installed source fonts are first in every font stack. The app does not install or
redistribute Microsoft fonts. Source names and point sizes stay in the editable
model and exported PPTX; substitute names and metric adjustments are only used
when rendering in Slide Studio.

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

## Remaining differences

Uninstalled commercial faces such as HY나무M, HY바다M and Sandoll fonts still use
local substitutes. Light-face shape/thickness, advanced typography, custom tab
stops, full script-specific punctuation rules and PowerPoint's layout engine can
still differ. PPTX exports reference fonts by name; they do not embed font files.
The font assets included in Slide Studio do not automatically travel with a PPTX.

# Presentation file compatibility

Slide Studio saves its complete editable model as a versioned JSON project. JSON
loading validates object kinds, IDs, slide and object limits, finite geometry,
font sizes, opacity, colors, embedded raster image signatures, rich paragraphs,
image crops, cell borders, and bounded numeric drawing paths. Unknown JSON
properties are discarded. Raw SVG, external image URLs, and script-bearing URLs
are not accepted.

PPTX export creates real editable PresentationML text boxes, basic shapes, lines,
arrow lines, and embedded images. It preserves slide dimensions, backgrounds,
object order, positions, sizes, rotations, paragraph/run formatting, text insets,
vertical writing, image crops/flips, supported custom paths, opacity, speaker
notes, and optional fade transitions. Table cells export as individual editable
text boxes with backgrounds and borders, rather than a native PowerPoint table.
Pixels are converted at 96 px/in;
font sizes and stroke widths are converted to points at 0.75 pt/px. Fonts are
referenced by name, not embedded. A recipient may need the same fonts for matching
line wrapping. The exported PPTX does not contain a hidden proprietary project.
Hidden-slide flags survive both project and PPTX round trips. Normal slideshow
navigation skips them; starting at the selected slide or entering its number can
still show a hidden slide explicitly.

PPTX import reads the presentation relationship list for slide order, not file
name sorting. It reads slide size, text, supported shapes, embedded raster images,
speaker notes, theme colors/fonts, basic placeholder inheritance from layouts and
masters, and group scale/translation, rotation, and reflection. Nested groups are
flattened from the inside out; rotated groups under a nonuniform parent scale
can require shear that the editable element model cannot represent and produce
a warning. Master/layout decorative artwork uses
its own image relationships and respects the slide's master-artwork visibility.
Simple text within a shape is split into a separate editable shape and text box.
Text box insets are folded into plain text geometry, or retained as padding for
filled/bordered text and table cells. Text body vertical alignment, wrapping,
insets, explicit normAutofit fontScale and line-spacing reduction inherit through
slide/layout/master placeholders. Paragraph alignment, spacing, indentation and
run fonts/sizes/colors/bold/italic/underline are retained. Latin/East Asian font inheritance, language, character spacing, kerning thresholds, default tabs and paragraph line-break flags survive project/PPTX round trips. Group geometry does not multiply authored text point sizes a second time. Text can overflow its
source box unless the source explicitly clips it. East Asian vertical text uses
upright glyphs. Diagonal straight connectors retain their endpoints through
length and rotation. Straight lines preserve their independent start/end markers
(none, triangle, stealth, diamond, oval or open arrow), marker width/length and
horizontal direction through project save and PPTX round trips. Curved connectors
remain outside this straight-line implementation.
First/last paragraph spacing follows `spcFirstLastPara` (off by default), so
inherited paragraph gaps do not displace single-line captions below the slide.
Absent paragraph line spacing uses the same 1.2 baseline as explicit 100%, with
normal-autofit reduction applied. This matches the measured Windows samples;
it is not a reconstruction of PowerPoint's font-dependent layout engine. Blank
paragraphs and explicit blank lines retain the full computed line advance,
including fixed point spacing and the size of each individual blank line.

Automatic list numbers count nonempty list items by level. Paragraph-level
`startAt` restarts a sequence, while an inherited start initializes it. The
current importer resolves labels into editable text and approximates non-Arabic
numbering formats as decimal labels. Imported hanging labels reserve the indent
without inserting an extra visible space. Project files preserve the label
metadata; PPTX exports these resolved labels as literal bullets, so automatic
renumbering after edits in PowerPoint is not preserved. Editing away a label in
Slide Studio returns that paragraph to ordinary text layout.
Bullet point/percentage sizes, fonts, and colors are resolved independently from
the body text, including explicit follow-text overrides. The resolved marker
style survives JSON and PPTX export; changing the body font size later does not
reapply the original relative bullet-size percentage. Non-placeholder text boxes
use presentation defaults before the master's otherStyle, while title/body
placeholders retain their separate layout/master inheritance.
Editing preserves existing soft line breaks and hard paragraph boundaries,
including empty paragraphs and their font/spacing. The editable DOM reader keeps
list separators and empty blocks without depending on Chromium's innerText,
which can omit them. New Enter breaks retain the editor's paragraph semantics.

Rounded rectangles retain their `adj` corner adjustment as a pixel radius through
project save, canvas scaling, and PPTX export, including explicitly square corners.
Ellipse and donut text uses the preset's inscribed rectangle before body margins,
so labels wrap within the round shape. Donut thickness follows the source `adj`
value and shortest side; custom paths retain native EMU precision for PPTX export.
The editing canvas clips artwork at the slide boundary, matching the preview and
exported page, while selection outlines and resize handles remain outside the clip.
East Asian line-breaking flags control Korean character wrapping. The inherited
`hangingPunct` flag survives project/PPTX round trips; the Chromium renderer allows
a terminal stop/comma to hang when it avoids an extra line, without changing the
text or widening its box. This fallback currently covers horizontal terminal
punctuation, not full line-edge punctuation rules for vertical or mixed writing.

Tables are flattened into editable cells, preserving supported merged-cell
geometry, row/column styling, fills, text and edge borders. When saved row heights
sum to less than the table frame, the extra height is allocated to multiline
cells first. Explicit line breaks retain their own run sizes, including blank
lines. Cells without an explicit paragraph line-spacing value use a 1.2 multiplier,
matching the observed Windows PowerPoint table layout; explicit point/percentage
spacing keeps its source value. Embedded TIFF images
are converted locally to PNG with a 16-million-pixel decode limit. Supported
numeric DrawingML custom paths, image crop/flip, and AlternateContent fallback
objects are rendered. SmartArt with a saved `diagramDrawing` part is imported as
individual shapes, lines and text, using the source relationships and geometry;
there is no SmartArt layout engine or automatic reflow. Source formulas stored as raster images remain images,
not editable equations. Safe custom paths are reconstructed from numeric commands;
arbitrary embedded SVG is still excluded.

The app bundles Carlito as a Calibri substitute and NAVER Nanum Barun Gothic.
Calibri Light uses a measured approximate fallback; other missing fonts use local
substitutes. See [font provenance and metrics](FONT_NOTES.md). Glyph appearance and line wrapping can
therefore differ, even with matching geometry. Gradients, advanced bullets,
formula-defined paths, effects, and flipped/rotated groups remain partial.
The known layout regressions and current limits are documented in
[the corpus report](qa/REPORT.md).

Charts, SmartArt without saved drawing geometry, object animations, hyperlinks, embedded OLE/ActiveX/macros,
and playable media are not imported. SVG/EMF/WMF images are excluded. Unsupported
objects and alternative content without a usable fallback produce warnings.
The JSON project is the format for lossless continuation in Slide Studio; PPTX
interchange is a documented editable subset, not full PowerPoint compatibility.

Imports never fetch relationships from the network or execute archive contents.
Limits: 256 MiB archive (also enforced by the browser/native file dialog), 200 MiB total declared and actually read uncompressed data,
5,000 ZIP entries, 24 MiB per part, 8 MiB XML part, 16 MiB raster image, 500 slides,
1,000 objects per slide, and 10,000 objects per deck. Archive paths and duplicate
entries are checked before decompression; actual output is counted while
streaming. Encrypted, multi-disk, and ZIP64 archives and XML DTD/entities are
rejected. Files are interpreted in memory and never extracted to disk.
Native file transport uses typed byte arrays rather than expanding each byte
into a JavaScript number array. Media size still counts toward archive limits
even when its contents are not imported or played.

Implementation references:

- [PptxGenJS text API](https://gitbrent.github.io/PptxGenJS/docs/api-text.html)
- [PptxGenJS shape API](https://gitbrent.github.io/PptxGenJS/docs/api-shapes.html)
- [JSZip loadAsync API and limitations](https://stuk.github.io/jszip/documentation/api_jszip/load_async.html)
- [UTIF TIFF decoder](https://github.com/photopea/UTIF.js)
- [Carlito font and license](https://github.com/googlefonts/carlito)
- [DrawingML normal autofit](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.normalautofit?view=openxml-3.0.1)
- [DrawingML automatic numbering and list levels](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.autonumberedbullet?view=openxml-3.0.1)
- [DrawingML first/last paragraph spacing](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.useparagraphspacing?view=openxml-3.0.1)
- [DrawingML bullet size percentage](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bulletsizepercentage?view=openxml-3.0.1)
- [DrawingML bullet font](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bulletfont?view=openxml-3.0.1)
- [PowerPoint table row sizing](https://support.microsoft.com/en-us/powerpoint/change-the-size-of-a-table-column-or-row-in-powerpoint)
- [Microsoft DrawingML extension specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/06cff208-c6e1-4db7-bb68-665135e5f0de)
- [DrawingML preset shape definitions (ellipse and donut)](https://github.com/LibreOffice/core/blob/master/oox/source/drawingml/customshapes/presetShapeDefinitions.xml)

UTIF, Carlito and Nanum Barun Gothic license texts are included in the app's `dist/licenses/` folder.

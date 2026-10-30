# Presentation file compatibility

The development editor now includes table-aware document find/replace, nondestructive
picture crop/fit/fill/replacement, a selection pane, and format painting. Search
and selection navigation do not author document changes. Replacing all text,
applying one image crop, and each layer or whole-object format action are atomic
document undo steps. Inline format painting is a single native text edit and
retains the selected range, rich-run links and paragraph metadata.

Object and group names use standard PresentationML `cNvPr@name` and visibility
uses `cNvPr@hidden`. Names can be duplicated. Internal object-state extensions
retain stable IDs for composite borders and distinguish automatic labels from
explicit user names. Own hidden state is independent of ancestor group hidden
state; unhiding a group preserves independently hidden descendants. Hidden objects
remain editable in the selection pane and saved to PPTX, but are excluded from
canvas painting, thumbnails, slide shows, and PDF/print rendering. Group sibling
reordering preserves hierarchy; moving an object into another group is not supported.

Picture operations retain the embedded original raster bytes and write the
standard image crop rectangle. Negative crop values represent fitted letterbox
space. Animated GIF bytes are retained through replacement, cropping and PPTX
round trips. The editor still uses a static preview; slide shows animate GIFs.

Format painting copies supported typography, alignment, fill, line and shadow
styles. It excludes content, geometry, IDs, names, visibility, links, grouping,
image source/crop, and chart data. Partial text painting only changes character
styles. Table cell painting preserves content, merges, and column widths; automatic
rows can expand to fit the resulting font. A gradient source uses its solid fallback
when applied to a table cell because gradient table-cell fills are not modeled.

Normal editing mounts slide-preview artwork around the thumbnail/sorter
viewport, retaining every slide button and its accessible name for selection,
keyboard navigation and drag/drop. The full print tree is mounted synchronously
on `beforeprint`; native printing waits for fonts/images and releases the tree
on success, cancellation or failure. Browser printing uses the same lifecycle.
Native PPTX import/export validates known model fields directly, without a
whole-document JSON encode/decode copy. Compact JSON length is counted with
escaping so the 200 MiB model limit and all existing asset/geometry checks
remain enforced. Legacy JSON input still checks its original file length.

Slide Studio saves user files as PowerPoint (.pptx). The separate .slide save
command has been removed. Existing .slide files remain readable so users can
migrate them to PPTX. The complete editor model is still autosaved locally in
IndexedDB; this local recovery is separate from a saved PPTX file. Native open,
save and PDF dialogs start in the last successfully opened/saved document folder,
remembered across app launches. Cancelled/failed operations and PDF output do not
change that document folder. Deleted folders fall back to Documents.

Legacy JSON loading validates object kinds, IDs, slide and object limits, finite geometry,
font sizes, opacity, colors, embedded raster image signatures, rich paragraphs,
image crops, cell borders, and bounded numeric drawing paths. Unknown JSON
properties are discarded. Raw SVG, external image URLs, and script-bearing URLs
are not accepted.

PPTX export creates real editable PresentationML text boxes, basic shapes, lines,
arrow lines, and embedded images. It preserves slide dimensions, backgrounds,
object order, positions, sizes, rotations, paragraph/run formatting, text insets,
vertical writing, image crops/flips, supported custom paths, opacity, speaker
notes, and optional fade transitions. Tables created with Insert → Table export
as native PowerPoint tables, including cell text, fills, borders and row/column
sizes. Previously flattened external table cells still export as individual
editable text boxes with backgrounds and borders.
Pixels are converted at 96 px/in;
font sizes and stroke widths are converted to points at 0.75 pt/px. Fonts are
referenced by name, not embedded. A recipient may need the same fonts for matching
line wrapping. The exported PPTX does not contain a hidden proprietary project.
Small, validated DrawingML extensions preserve the supported native-table style
model and generated footer field kind. These extensions do not embed the deck.
Hidden-slide flags survive both project and PPTX round trips. Normal slideshow
navigation skips them; starting at the selected slide or entering its number can
still show a hidden slide explicitly.

PPTX import reads the presentation relationship list for slide order, not file
name sorting. It reads slide size, text, supported shapes, embedded raster images and supported videos,
speaker notes, theme colors/fonts, basic placeholder inheritance from layouts and
masters, and group scale/translation, rotation, and reflection. Group hierarchy is
retained while child geometry is resolved into slide coordinates; rotated groups under a nonuniform parent scale
can require shear that the editable element model cannot represent and produce
a warning. Master/layout decorative artwork uses
its own image relationships and respects the slide's master-artwork visibility.
Text within a shape stays in one editable shape with its native text body.
Text box outer geometry and four insets are retained. Text body vertical alignment, wrapping,
insets, explicit normAutofit fontScale and line-spacing reduction inherit through
slide/layout/master placeholders. Paragraph alignment, spacing, indentation and
run fonts/sizes/colors/bold/italic/underline are retained. Latin/East Asian font inheritance, language, character spacing, kerning thresholds, default tabs and paragraph line-break flags survive project/PPTX round trips. Group geometry does not multiply authored text point sizes a second time. Text can overflow its
source box unless the source explicitly clips it. East Asian vertical text uses
upright glyphs. Diagonal straight connectors retain their endpoints through
length and rotation. Straight lines preserve their independent start/end markers
(none, triangle, stealth, diamond, oval or open arrow), marker width/length and
horizontal direction through project save and PPTX round trips. Bent/curved connectors use their saved preset geometry, without live endpoint attachment to other objects.
First/last paragraph spacing follows `spcFirstLastPara` (off by default), so
inherited paragraph gaps do not displace single-line captions below the slide.
Absent paragraph line spacing uses the same 1.2 baseline as explicit 100%, with
normal-autofit reduction applied. This matches the measured Windows samples;
it is not a reconstruction of PowerPoint's font-dependent layout engine. Blank
paragraphs and explicit blank lines retain the full computed line advance,
including fixed point spacing and the size of each individual blank line.

Automatic list numbers count nonempty list items by level. Paragraph-level
`startAt` restarts a sequence, while an inherited start initializes it. The
importer resolves labels into editable text while preserving the numbering type and level. Arabic, alphabetic and Roman labels are rendered; some East Asian/special labels remain approximate. Imported hanging labels reserve the indent
without inserting an extra visible space. Project files preserve the label
metadata; PPTX exports automatic lists with their `buAutoNum` type and start value. Editing away a label in
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

Ordinary imported and newly created tables reopen as native editable tables,
including supported merges, rich cell paragraphs, insets and asymmetric edges.
The app extension retains editor-specific options; actual text and formatting
are read from the standard XML. Damaged tables or tables beyond 100 rows × 50 columns
fall back to individual cell objects where possible. When saved row heights
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

Embedded PNG/JPEG/GIF/WebP slide background pictures are resolved from the owning
slide, layout, or master relationship part, with slide-local backgrounds overriding
inherited ones. Stretched backgrounds retain source cropping and opacity in the
editor, thumbnails, slideshow, and print view. PPTX export writes a native
`p:bgPr/a:blipFill`, rather than adding an editable full-slide picture. Background
assets share the 16 MiB image and 100 MiB combined asset limits; external image
URLs are never fetched. Tiled backgrounds, offset stretch fill rectangles, and
unsupported background image formats still fall back with an import warning.
Empty title/subtitle placeholders are not literal document text; external editors
may display their own editing hints such as “Click to add Title”.

The app bundles Carlito as a Calibri substitute and NAVER Nanum Barun Gothic.
Calibri Light uses a measured approximate fallback; other missing fonts use local
substitutes. See [font provenance and metrics](FONT_NOTES.md). Glyph appearance and line wrapping can
therefore differ, even with matching geometry. Linear/centered radial gradients,
dash patterns, outer shadows and 187 formula-defined presets are supported.
Preset paths preserve light/dark face shading, adjustment guides, curved/bent connector markers, and the geometric radius angles used by DrawingML ellipses. Three-aspect-ratio import/export coverage includes all 187 presets; this does not establish pixel-identical rendering for every PowerPoint version or effect.
Picture/pattern fills, advanced bullets, inner/3D effects, radial focus details
and sheared groups remain partial or unsupported.
The known layout regressions and current limits are documented in
[the corpus report](qa/REPORT.md).

Newly inserted column/bar, line and pie charts are native DrawingML charts with
an embedded XLSX workbook. Double-click, Enter, the inspector or the context menu
opens a draft editor for data/title/type/color. Apply is one undo step; cancel
and unchanged apply create no history. The editor supports one series and up to
12 categories and remains available after PPTX reopening. It does not connect to
an external Excel file. An extension marks editor-authored charts, but values
are always read from standard chart caches. Unsupported added series or external
links retain the original chart package instead of being rebuilt. Older charts
made from individual shapes are not automatically converted.
Insert-generated diagrams, icons, WordArt and equations use editable shapes,
text and numeric custom paths, rather than SmartArt/Office Math data objects.
Slide numbers export as native `slidenum` fields. Generated dates and footer
labels preserve their field kind in this app; automatic dates refresh here and
export their current text rather than an Office automatic-date field.
Web links accept only HTTP(S) without embedded credentials. Whole-object web and
internal-slide links survive export/import and work during presentation. Partial
text-run links retain distinct targets; only linked words activate during a show.
Complete text with the same link can also be promoted to an object link. Imported slide numbers with a nondefault starting
number preserve their displayed text and report that automatic renumbering was
not retained.

Animated GIF data is never rasterized during insertion, project save, or PPTX
import/export. Its frame delays, transparency, disposal and loop metadata remain
in the original bytes; Chromium renders the animation. GIF loop count follows
the file. No new APNG file input or APNG-specific controls are added.

MP4 and WebM videos are embedded as original bytes, with a separate PNG poster.
New insertions default to automatic start, loop and mute; each setting can be
changed in the inspector. Only the active audience slide creates video players;
editor thumbnails, presenter previews, printing and PDF use the poster. Changing
slides, ending the show, or blanking the screen stops the player. A manual play
control is shown if autoplay is blocked. Unsupported codecs show a visible error;
H.264 MP4 and VP8 WebM were tested on packaged Mac and Windows apps and installed
Ubuntu 22.04/24.04 apps. VP9 WebM uses the bundled Chromium decoder but was not
part of those fixtures. See the 1.6.2 release report for the native test runs.

PPTX video uses native video/media relationships and standard PresentationML
cMediaNode timing, including loop and mute. Simple immediate playback and
immediate mediacall play commands are read; arbitrary animation/trigger chains,
trim/fade/bookmark/play-across-slide settings are not reconstructed. External
relationships never load. Oversize, unsupported or over-budget imported videos
fall back to their poster with a warning so a large deck can still open. Original
movie data for those fallback items is not retained in the imported project.
A repeated video part is decoded/read once per import. The generated PPTX media
and timing XML is round-trip tested; playback in Microsoft PowerPoint itself
has not been verified on this Mac.

Imported classic DrawingML charts retain their original chart XML, cached data,
embedded XLSX workbooks, and supported chart styles/color parts. The editor
previews line, column/bar, area, pie/doughnut, scatter and simple combinations
as vector graphics. Move, resize, rotate, duplicate, group, print/PDF and native
PPTX save/reopen preserve the chart; data editing of externally authored charts
is done in PowerPoint.
Part names/relationships are remapped per exported object so copied charts do
not share or overwrite their workbooks. External references are never fetched.
Preview differences remain for advanced labels/layouts, 3D effects and secondary
axes. Unsupported preview types show a notice while preserving native data.
Each chart package is limited to 128 parts / 16 MiB; previews to 64 series,
10,000 points per series and 100,000 points total. Charts count toward the
100 MiB embedded-asset budget.

SmartArt without saved drawing geometry, object animations, audio and SVG/EMF/WMF
artwork do not gain editable/playing representations in this app. Their native
source data can nevertheless survive PPTX saving. Imports needing preservation
retain one bounded source archive in the local model/autosave, with hashes and
bindings to editable objects. This data is also retained by internal slide copy
and undo/redo. An exported PPTX contains reachable standard Office parts, not the
source archive or a hidden JSON project.

Unchanged native objects retain their source XML. Changed supported objects are
rebuilt with the original unmodeled paint, picture/vector sources and unchanged
text bodies where possible. Source layout/master dependencies, rich unchanged
notes, animation/audio timing, native transitions, font embeddings and custom
shows are preserved. Relationship, shape, timing and global master/layout IDs are
remapped; deleted-object animations and unreachable assets are removed. Changed
video playback uses the new settings. Explicitly choosing None/Fade overrides a
preserved unsupported transition. Presentation-level settings belong to their
original document; copying a slide does not copy its custom show definitions.

Some edits still require a compatibility decision: edited SmartArt/extension
content may become individual objects; opaque members of a moved/resized group
retain their original placement; edited text/table content may lose unmodeled
rich formatting. Nondefault slide-number fields keep their visible fixed text.
Macros, ActiveX, OLE and external media/package links are excluded. These actual
exclusions are collected during export and the app asks before invoking file
save; cancelling leaves the original file and unsaved-file protection intact.
Unusable source data fails before writing. Source snapshots also count toward
the 200 MiB model limit. When they cannot fit, import and save explicitly report
that unsupported source content cannot be retained. Normal unsupported-free files
do not need a snapshot. The app never renders/executes the opaque data or loads
its external relationships. See [preservation QA](qa/PPTX-PRESERVATION-2026-10-30.md).

PPTX interchange remains a documented editable subset with native passthrough,
rather than a full PowerPoint rendering, animation or SmartArt engine.

Imports never fetch relationships from the network or execute archive contents.
Limits: 256 MiB archive (also enforced by the browser/native file dialog), 200 MiB total declared and actually read uncompressed data,
5,000 ZIP entries, 24 MiB per part, 8 MiB XML part, 16 MiB raster image, 20 MiB video, 100 MiB combined embedded raster/video data, 500 slides,
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

UTIF, Carlito, Nanum Barun Gothic and Apache POI preset geometry license texts are included in the app's `dist/licenses/` folder.

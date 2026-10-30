# Public metafile regression samples

Four small samples from [ChristopherVR/emf-converter](https://github.com/ChristopherVR/emf-converter), licensed under Apache-2.0 (included `LICENSE`). Exact download URLs and byte counts are in `SOURCES.json`.

These cover EMF/EMF+ gradients and clipping, WMF mapping modes, compound shapes and embedded bitmaps. The independent binary fixtures built in `tests/vector-fixtures.ts` additionally exercise the import/export package path without depending on the converter's own fixtures.

Rendered images are checked for nonempty visible content and inspected visually; this does not assert pixel identity with Microsoft PowerPoint or Windows GDI.

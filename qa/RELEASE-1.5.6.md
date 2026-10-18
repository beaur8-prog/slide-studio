# Slide Studio 1.5.6 verification

This release adds an inline formatting container for editing plain text. Native
Windows evidence from the withheld 1.5.5 candidate showed that formatting the
first two letters of `OUR APPROACH` created separate column-flex items and an
unintended visual line break. The new regression failed before the fix and
passes after it, including undo/redo and reload. Paragraph-based imported text
and static unformatted rendering retain their existing structure.

The release also includes all text-selection/context menu, partial-color
Apply/Cancel, original-font and Unicode fallback improvements prepared for
1.5.5. The production application is validated before the latest download and
existing Lithos document are switched. Final package hashes, full-suite results
and native Windows run are recorded here after those checks complete.

The current Mac is locked; its running local app is preserved while a separate
temporary signed bundle produces the 1.5.6 ZIP. No user documents or profiles
are replaced. Mac ZIP extraction/signature and Windows Setup payload validation
are part of the publication gate.

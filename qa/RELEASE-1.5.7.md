# Slide Studio 1.5.7 verification

This release includes automatic wrapping/height for newly inserted text boxes, wrapping and height controls for existing boxes, a chart data-link limitation notice before insertion, and inherited native PPTX text-column count/gap preservation. Fixed imported layouts remain unchanged until the user enables automatic height. Automatic-height settings persist in .slide projects; PPTX receives the calculated geometry.

The production fixes in `af0ad93899c73281425a1df09d1a9477002794c2` passed the complete 178-case suite: **176 passed, 2 environment skips, 0 failures**. The skips require a local Office font cache and native Windows fullscreen on the Mac. [Detailed text/layout checks and three additional public decks](TEXT-LAYOUT-2026-10-18.md) describe the source corpus and limits.

Release-specific production/package checks and the exact Windows installed-application verification are recorded here after they complete. Native Windows QA adds long Korean wrapping/height, manual-height mode, persistence after reload and chart notice checks in addition to the existing installer and presentation/text/font tests.

Mac uses ad-hoc signing without Apple notarization. Windows has no distribution certificate. Physical Windows 10/11 IME typing, actual screen-capture permission prompts, paper printing and pixel-identical PowerPoint rendering are outside this release's verification scope.

# Slide Studio 1.5.8

This release fixes partial text formatting and numeric inputs that changed values while the user was still typing.

- Selecting only “Beta” in “Alpha Beta” and clicking Home Italic formats only Beta, preserving the selection and native undo/redo. Bold and underline use the same selection-preserving path.
- Width, height, rotation and other inspector fields, plus Home font size, keep the complete draft until Enter or blur. Escape cancels. Minimum/maximum bounds apply only at commit.
- Text, shape and image checks cover width 200, height 200, rotation −15 and text font size 24 in seven-slide documents, with reload persistence and an untouched first slide.

Release verification is in progress; final package hashes and native OS results will be recorded before stable publication. Existing download asset names and the Lithos document URL are preserved.

# Easy everyday trousers, v7

`trousers.png` is the active realistic relaxed-straight trouser layer for the Easy everyday starter. It was generated as a transparent standalone garment and registered with `trousers.json` for its crop, alpha bounds and hit outline. The runtime applies an explicit transform in `studio-everyday-render.ts`; the next asset revision should keep the garment artwork separate from the figure.

The starter fit is tuned against the fixed model's lower-body trace in v8. The trace script compares this file's alpha bounds to its hip-to-ankle guide and writes the runtime transform into `v8/trouser-fit-calibration.json`. It aims for moderate ease and a waist-to-ankle span, rather than a fixed oversized palazzo width. Shoes remain in the Styled with card while ankle placement is not reliable enough to composite.

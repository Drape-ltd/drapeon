# Easy everyday shoe art — v5

This pass replaces the flat and loafer cutouts after live browser review showed
the previous pair proportions looked too large and floated below the model.
Both pieces were generated as transparent raster artwork, then packaged with
alpha-derived bounds and hit paths by `scripts/prepare-everyday-assets.mjs`.

The `*-source.png` files preserve the original generated art. The paired
`*.png` files are trimmed, size-limited runtime assets, and `*.json` files hold
placement and hit-test metadata. The source art is not used as SVG artwork.

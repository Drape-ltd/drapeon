# Easy everyday model foreground, v9

`front-human-shorts.png` and `front-human-leggings.png` plus matching `front-head-*.png` files are generated from their fixed model bases by `packages/drape-studio/scripts/create-everyday-human-foreground.mjs`. The arm images preserve only the arms and drop grey garment pixels. The renderer subtracts the active top's alpha from the arm foreground so skin stays behind sleeves and shoulders; the face, hair and natural neckline remain above the editable clothes.

The renderer selects the matching arm foreground for each base image. This replaces a coarse polygon clip that could let small pieces of the grey underlayer paint over tops at the shoulders. The generated layers are intentionally model-specific; do not reuse one foreground cutout with the other base variant.

# Easy everyday v2 asset provenance

Created with the built-in imagegen tool on 2026-10-01 for one fixed, fictional adult figure. The two modest base images show a grey scoop-neck sleeveless top with either shorts or leggings. Garments and accessories were generated individually as transparent PNG sprites for compositing; they were not clipped from a full-outfit image. This is a 2D authored wardrobe, with no 3D model or live generation provider in the editor.

The following are semantic summaries of the generation requests, not verbatim prompts. Individual generations vary; these assets are not claimed to match another source image pixel for pixel.

| Output stem | Generation intent | Original source file |
| --- | --- | --- |
| `base-shorts` | Full-length, front-facing fictional adult woman in a neutral standing pose, wearing a modest grey scoop-neck sleeveless top and fitted shorts, on transparency. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-120503a0-83cb-4bed-bc63-a50ce8336130.png` |
| `base-leggings` | Matching fixed-figure base direction, with the modest grey sleeveless top and full-length leggings for coverage when no lower garment is selected. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-8c5c7b52-b632-4fed-8fe5-c215d37acbf6.png` |
| `shirt` | Standalone ivory short-sleeve collared button shirt with rolled cuffs, chest pocket and natural fabric shading; transparent background and open neckline. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-581c0f08-40d2-4109-b65c-048ba8009eeb.png` |
| `sleeveless` | Standalone ivory sleeveless top, simple round neckline and softly textured fabric, for the same outfit direction. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-2c2f9121-bc77-4b24-bd23-c7043e68dc87.png` |
| `trousers` | Standalone muted olive wide-leg trousers with waistband, front fastening, belt loops and fabric folds. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-5c74e10a-3947-49b8-a541-df6668d5a472.png` |
| `skirt` | Standalone muted olive A-line midi skirt with a waistband, soft pleats and fabric shading. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-eca2174e-89b8-4b90-b162-63b9e9b8d96c.png` |
| `sandals` | Standalone pair of brown leather sandals, with straps, buckles and perspective suitable for the standing figure. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-5ba28857-7187-4972-bf4d-ec43edb5fbf8.png` |
| `bag` | Standalone brown leather crossbody bag with a long diagonal strap, flap, stitching and metal buckle details. | `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-0e3abc73-6463-46ce-938d-14c511462dba.png` |

The final shirt source is `exec-581c0f08-40d2-4109-b65c-048ba8009eeb.png`. The earlier `/Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-b5ceea7f-b9e6-42f4-9682-2cddfc1903d8.png` was rejected for its halo and is not the shipped shirt.

From the repository root, package each source using its corresponding output stem:

```sh
node packages/drape-studio/scripts/prepare-everyday-assets.mjs \
  /Users/onaopemipodimowo/.codex/generated_images/01a0eaaa-608f-7dc0-b6d3-3d51b5c76504/exec-581c0f08-40d2-4109-b65c-048ba8009eeb.png \
  packages/drape-studio/assets/wardrobe/easy-everyday/v2/shirt
```

The utility validates real alpha, trims only fully transparent outer margins, and downsizes only when needed to an 800-pixel maximum dimension. It writes a PNG plus JSON containing the original dimensions, alpha bounds, crop bounds, packaged dimensions and approximate alpha contours. Crop bounds preserve placement in the original image coordinate system; faint nonzero alpha remains intact. No artwork is reconstructed from the contours.

`packages/drape-studio/src/studio-everyday-render.ts` registers each sprite to the fixed figure and applies its placement transform to both the PNG and its invisible hit area. JSON `hit.path` contours use the `evenodd` fill rule for transparent holes; actual garment imagery comes from the PNG. These authored shapes support the available wardrobe choices, not arbitrary garment reconstruction or fit prediction. Palette tinting supplies approximate visual colour directions and does not guarantee a real fabric colour match.

# Easy everyday v4: shoes, bags and finishing touches

The PNGs in this folder are image-generated, fictional styling assets for the Easy everyday model. `prepare-everyday-assets.mjs` preserves the transparent artwork and writes a companion JSON file with alpha bounds and an invisible selection contour. The raster artwork, rather than the contour, is what appears in the Studio.

| Asset | Use | Image generation source |
| --- | --- | --- |
| `flats.png` | Pair of neutral everyday flats | `exec-c4009b83-866d-475c-a191-08799640815f.png` |
| `loafers.png` | Pair of brown everyday loafers | `exec-4194f8ef-275e-4466-a438-1d1cea1b24c2.png` |
| `shoulder-bag.png` | Brown leather shoulder bag | `exec-ece47ed2-b510-4497-ba5d-c9d7c839b61c.png` |
| `hoop.png` | One gold hoop; mirrored to make a pair | `exec-c3364f92-ac94-4ce2-b9a8-96a5ae42ec37.png` |
| `necklace.png` | Gold chain with a pendant | `exec-abcc4b97-1da4-451b-a426-57f02c126b01.png` |
| `sunglasses.png` | Dark everyday sunglasses | `exec-2fa19dc0-c3ca-4fc6-9a00-f5d3a9ec3920.png` |

The `EverydayBaseVariant` rule in `studio-everyday-state.ts` selects a full-length leggings base when no bottom is selected, a fitted shorts base under selected bottoms, and a covered-foot base for closed shoes. Sleeveless tops select the exposed-arm foreground. Each garment family can add a base variant by declaring its lower-body, footwear and arm-coverage needs in that contract; the editor does not infer tailoring or body fit from a picture.

The assets are exploratory design illustrations, not product photography or an exact colour promise. Physical material and construction remain for the wearer and maker to confirm.

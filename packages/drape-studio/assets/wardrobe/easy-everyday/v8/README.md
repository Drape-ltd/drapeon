# Easy everyday leg-fit guide, v8

`trouser-fit-mask.png` and its outline are a non-rendered fit guide traced from the fixed Easy everyday shorts base. The reproducible source is `packages/drape-studio/scripts/create-everyday-trouser-fit-mask.mjs`. It identifies the modest hip/shorts panel and both leg contours while excluding hands and bare feet. The same script writes `trouser-fit-calibration.json` from the guide bounds, the v7 garment alpha bounds, a 5.5% ease allowance and the fixed model's hip center.

The active trouser layer imports the generated calibration for its waist-to-ankle height, center and width. The guide is deliberately not used as a clipping mask: a clip experiment produced visible seams at the garment edge. The rendered clothing remains a clean transparent raster image.

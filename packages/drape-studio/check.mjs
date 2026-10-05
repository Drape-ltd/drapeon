import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const output = await build({
  stdin: {
    contents:
      "export * from './src/studio-state';export * from './src/studio-storage';export * from './src/studio-collection';export * from './src/studio-render';export * from './src/studio-sheet';export * from './src/studio-sketch-sheet';export * from './src/studio-placement-state';export * from './src/studio-everyday-state'",
    resolveDir: new URL('.', import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  format: 'esm',
  loader: { '.png': 'dataurl', '.jpg': 'dataurl' },
})
const m = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
)
const image = 'data:image/jpeg;base64,/9j/2Q=='
const look = m.parseLook({
  ...m.DEFAULT_LOOK,
  canvasMode: 'paper',
  sketchUnderlay: { image, opacity: 0.4, visible: true },
  sketch: [
    {
      colour: '#123456',
      width: 3,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
    },
  ],
  colourNames: { colour: 'Dusty rose' },
  directions: { keep: 'Sleeves', change: 'Longer hem', remove: 'Belt', confirm: 'Fabric swatch' },
})
assert.deepEqual(m.parseSavedLooks(JSON.parse(JSON.stringify([look]))), [look])
assert.deepEqual(m.parseDraft(JSON.parse(JSON.stringify(look))), look)
assert.equal(m.parseDraft(null), null)
assert.throws(() => m.parseDraft({ ...look, version: 99 }))
const pinch = m.transformPlacementWithPointers(
  m.neutral(),
  [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  [{ x: 5, y: 5 }, { x: 25, y: 5 }],
)
assert.equal(pinch.scale, 2)
assert.equal(pinch.x, 10)
assert.equal(pinch.y, 5)
assert.equal(pinch.rotation, 0)
const twist = m.transformPlacementWithPointers(
  m.neutral(),
  [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 10 }],
)
assert.equal(twist.rotation, 90)
const briefHandoff = m.parseStudioBriefHandoff({ image: 'data:image/png;base64,iVBORw0KGgoAAA==', notes: 'Colour targets: Dusty rose #BA7D86', name: 'Wedding look', design: look })
assert.equal(briefHandoff.name, 'Wedding look')
assert.deepEqual(briefHandoff.design, look)
assert.throws(() => m.parseStudioBriefHandoff({ image: 'data:image/png;base64,iVBORw0KGgoAAA==', notes: '', design: { version: 99 } }))
assert.throws(() => m.parseStudioBriefHandoff({ image: 'https://example.com/image.png', notes: '' }))
assert.throws(() => m.parseStudioBriefHandoff({ image: 'data:image/png;base64,iVBORw0KGgoAAA==', notes: 'x'.repeat(1201) }))
const svg = m.renderIllustration(look)
const editorialFigure = m.renderIllustration(m.parseLook({ ...m.DEFAULT_LOOK, outfit: 'dress', headwear: true }))
assert.ok(editorialFigure.includes('<svg x="216" y="69" width="68" height="88"'), 'Portrait stays near the approved editorial head-to-body proportion')
assert.ok(editorialFigure.includes('Q181 181 171 194'), 'Figure arms have a softer, fuller silhouette with limb definition')
assert.ok(editorialFigure.includes('Q206 393 212 445'), 'Legs use a shaped, natural contour instead of straight stick-like edges')
assert.ok(editorialFigure.includes('url(#baseFabric)'), 'Neutral base layers have dimension rather than a flat fill')
assert.ok(editorialFigure.includes('clipPath id="headwearDetailClip"'), 'Headwear embroidery stays clipped inside the selected wrap silhouette')
const wardrobeLook = m.parseLook({ ...m.DEFAULT_LOOK, wardrobeArt: 'occasion-teal', outfit: 'dress', shoes: 'heels', headwear: true, beads: true, earrings: true, bracelet: true, bag: 'shoulder' })
const wardrobeMarkup = m.renderIllustration(wardrobeLook)
const wardrobeImageCount = (wardrobeMarkup.match(/data:image\/png;base64,/g) ?? []).length
assert.equal(wardrobeImageCount, 10, 'The complete illustrated outfit composes its figure, garment, and independently enabled accessories')
assert.ok(wardrobeMarkup.includes('x="60" y="80" width="380" height="640"'), 'The generated figure keeps closer to its natural aspect ratio instead of becoming stick-thin')
assert.ok(wardrobeMarkup.includes('x="204" y="0" width="92" height="86"'), 'The gele is placed fully inside the canvas above the model’s hairline')
assert.equal(m.STARTER_LOOKS.find((starter) => starter.label === 'Teal occasion')?.look.cut, 'aline', 'The look-sheet metadata matches the generated A-line gown')
assert.ok(wardrobeMarkup.includes('x="60" y="154" width="380" height="490"'), 'The fit-matched dress shares the figure center and is wide enough to cover the base shorts')
assert.ok(wardrobeMarkup.includes('x="203" y="110" width="20" height="48" viewBox="64 24 64 224"'), 'The left earring is cropped and anchored to the model earlobe')
assert.ok(wardrobeMarkup.includes('x="267" y="110" width="20" height="48" viewBox="128 24 64 224"'), 'The right earring is cropped and anchored to the model earlobe')
for (const wardrobeArt of ['soft-tailoring','after-hours','long-line','celebration','city-layers','one-piece-ease','light-gathered','weekend-light','soft-volume','clean-lines']) {
  const art = m.renderIllustration(m.parseLook({ ...m.DEFAULT_LOOK, wardrobeArt }))
  assert.ok(art.includes(`data-raster-wardrobe-art="${wardrobeArt}"`), `${wardrobeArt} renders from its complete-look image asset`)
  assert.ok(art.includes('data:image/jpeg;base64,'), `${wardrobeArt} uses raster wardrobe artwork rather than vector stand-ins`)
}
const wardrobeWithoutExtras = m.renderIllustration({ ...wardrobeLook, headwear: false, beads: false, earrings: false, bracelet: false, bag: 'none', shoes: 'loafers' })
assert.equal((wardrobeWithoutExtras.match(/data:image\/png;base64,/g) ?? []).length, 3, 'Turning accessories off removes their image layers while keeping the figure and dress')
const editableEveryday = m.snapshot(m.STARTER_LOOKS.find((starter) => starter.look.wardrobeArt === 'easy-everyday').look)
const editableEverydayMarkup = m.renderIllustration(editableEveryday)
assert.deepEqual(m.everydayBaseVariant(editableEveryday.everydayPieces), { lower: 'shorts', footwear: 'open', arms: 'base' })
assert.deepEqual(editableEveryday.everydayPieces, { top: 'shirt', bottom: 'trousers', shoes: 'sandals' })
assert.equal(editableEveryday.bag, 'crossbody')
assert.equal(editableEveryday.wardrobeArt, 'easy-everyday', 'Easy everyday keeps its starter identity')
assert.ok(editableEverydayMarkup.includes('data-everyday-base="shorts"'), 'A selected bottom uses the fitted shorts base')
assert.ok(editableEverydayMarkup.includes('data:image/png;base64,'), 'Easy everyday uses transparent realistic PNG pieces')
assert.ok(!editableEverydayMarkup.includes('data-raster-wardrobe-art'), 'The pilot uses separate pieces rather than a complete outfit image')
for (const layer of ['main', 'bottom', 'shoes', 'bag']) assert.ok(editableEverydayMarkup.includes(`data-layer="${layer}"`), `Easy everyday exposes ${layer} as an editable layer`)
for (const piece of ['shirt', 'trousers', 'sandals', 'bag']) assert.ok(editableEverydayMarkup.includes(`data-everyday-piece="${piece}"`), `The selected ${piece} asset is visible`)
assert.ok(editableEverydayMarkup.includes('data-styled-with="true"'), 'Shoes and bags are presented as intentional lookbook styling references')
assert.ok(editableEverydayMarkup.includes('data-placement-fixed="true"'), 'Styled-with references stay in their editorial tray instead of floating around the figure')
assert.ok(editableEverydayMarkup.includes('matrix(0.56 0 0 0.55 225 50)'), 'The shirt keeps its shoulder, neckline and hem alignment on the fixed model')
assert.match(editableEverydayMarkup, /data-everyday-piece="trousers"[^>]*data-fit="leg-outline-calibrated"[^>]*transform="scale\(\.48828125\)"/, 'The starter trousers use the leg-traced fit calibration')
assert.ok(editableEverydayMarkup.includes('matrix(0.76 0 0 0.515 122.9 649)'), 'The trouser layer uses the generated trace-to-garment calibration')
assert.ok(editableEverydayMarkup.includes('data-model="fixed"'), 'The realistic model remains separate from movable pieces')
assert.ok(editableEverydayMarkup.includes('data-neutral-cover="true"'), 'The model retains a modest fitted base')
assert.ok(editableEverydayMarkup.includes('data-model-foreground="true"'), 'Only the model’s hair, face, neck and skin remain above the editable clothes')
assert.ok(editableEverydayMarkup.includes('data-model-head-foreground="true"'), 'The model face and neckline stay above the editable clothes')
assert.match(editableEverydayMarkup, /mask="url\(#easy-\d+-human-occlusion\)"/, 'Arm foreground is masked to the active top alpha with a render-scoped definition')
assert.ok(!editableEverydayMarkup.includes('easyForeground'), 'A coarse clipped underlayer is not painted over fitted garment edges')
const secondEverydayMarkup = m.renderIllustration(editableEveryday)
const everydayDefinitionIds = (markup) => [...markup.matchAll(/id="(easy-[^"]+)"/g)].map((match) => match[1])
assert.ok(everydayDefinitionIds(editableEverydayMarkup).every((id) => !everydayDefinitionIds(secondEverydayMarkup).includes(id)), 'Live models and wardrobe thumbnails never share SVG definition IDs')

for (const [field, piece] of [['colour', 'shirt'], ['lowerColour', 'trousers'], ['shoeColour', 'sandals'], ['bagColour', 'bag']]) {
  const recoloured = m.renderIllustration(m.parseLook({ ...editableEveryday, [field]: '#ba7d86' }))
  assert.match(recoloured, new RegExp(`data-everyday-piece="${piece}"[^>]*data-colour="#ba7d86"`), `The ${piece} receives its own colour target`)
}

assert.deepEqual(m.parseEverydayPieces(undefined), { top: 'shirt', bottom: 'trousers', shoes: 'sandals' }, 'Older drafts receive the starter pieces')
assert.deepEqual(m.parseEverydayPieces({ top: 'invalid', bottom: 'invalid', shoes: 'invalid' }), { top: 'shirt', bottom: 'trousers', shoes: 'sandals' }, 'Unsupported piece values are rejected')
const everydayVariants = m.parseLook({ ...editableEveryday, everydayPieces: { top: 'sleeveless', bottom: 'skirt', shoes: 'none' }, bag: 'none' })
const variantMarkup = m.renderIllustration(everydayVariants)
for (const piece of ['sleeveless', 'skirt']) assert.ok(variantMarkup.includes(`data-everyday-piece="${piece}"`))
for (const piece of ['shirt', 'trousers', 'sandals', 'bag']) assert.ok(!variantMarkup.includes(`data-everyday-piece="${piece}"`))
assert.deepEqual(m.parseSavedLooks(JSON.parse(JSON.stringify([everydayVariants]))), [everydayVariants], 'Saved variants and removed pieces reopen unchanged')
assert.deepEqual(m.parseDraft(JSON.parse(JSON.stringify(everydayVariants))), everydayVariants)
assert.ok(m.designLines(everydayVariants).includes('Top: Sleeveless top'))
assert.ok(m.designLines(everydayVariants).includes('Bottom: Midi skirt'))
assert.ok(m.designLines(everydayVariants).includes('Footwear: None'))
assert.deepEqual(m.accessoryDescriptions(everydayVariants), [])
assert.deepEqual(m.colourRows(everydayVariants).map((row) => row.label), ['Main fabric', 'Bottom fabric'])
assert.ok(!m.designLines(everydayVariants).some((line) => /neckline:|collar:|Shape:/i.test(line)), 'The sheet does not claim unsupported geometry edits')
const everydayWithDetails = m.parseLook({ ...editableEveryday, everydayPieces: { ...editableEveryday.everydayPieces, shoes: 'loafers' }, bag: 'shoulder', earrings: true, beads: true, sunglasses: true })
const detailsMarkup = m.renderIllustration(everydayWithDetails)
for (const piece of ['loafers', 'shoulder', 'hoop', 'necklace', 'sunglasses']) assert.ok(detailsMarkup.includes(`data-everyday-piece="${piece}"`), `${piece} is an authored raster styling piece`)
assert.match(detailsMarkup, /clip-path="url\(#easy-\d+-shoe-base\)"/, 'Closed shoes select the covered-foot base variant')
assert.ok(detailsMarkup.includes('data-base-arms="base"') && detailsMarkup.includes('data-footwear-base="closed"'))
assert.deepEqual(m.accessoryDescriptions(everydayWithDetails), ['hoop earrings', 'pendant necklace', 'sunglasses', 'shoulder bag'])
assert.ok(m.designLines(everydayWithDetails).includes('Footwear: Loafers'))
assert.ok(m.designLines(everydayWithDetails).includes('Bag: Shoulder bag'))
for (const [field, layer] of [['colour', 'main'], ['lowerColour', 'bottom'], ['shoeColour', 'shoes'], ['accentColour', 'bag']]) {
  const removed = m.snapshot(editableEveryday)
  m.removeEverydayPiece(removed, field)
  const removedMarkup = m.renderIllustration(removed)
  assert.ok(!removedMarkup.includes(`data-layer="${layer}"`), `Removing ${layer} removes that rendered piece`)
  assert.equal(removed.wardrobeArt, 'easy-everyday')
  assert.ok(removedMarkup.includes('data-model="fixed"'))
  assert.ok(removedMarkup.includes(`data-everyday-base="${layer === 'bottom' ? 'leggings' : 'shorts'}"`), 'Only bottom removal changes the fitted base')
}
const freshEveryday = m.snapshot(editableEveryday)
freshEveryday.placements.main = { x: 45, y: 25, rotation: 15, scale: 1.2, locked: false }
m.resetEveryday(freshEveryday)
assert.deepEqual(freshEveryday.everydayPieces, { top: 'none', bottom: 'none', shoes: 'none' })
assert.equal(freshEveryday.bag, 'none')
assert.equal(freshEveryday.wardrobeArt, 'easy-everyday')
assert.deepEqual(freshEveryday.placements, {})
assert.deepEqual(m.colourRows(freshEveryday), [])
assert.ok(!m.renderIllustration(freshEveryday).includes('data-everyday-piece='))
assert.ok(m.renderIllustration(freshEveryday).includes('data-everyday-base="leggings"'))
assert.deepEqual(m.parseLook(JSON.parse(JSON.stringify(freshEveryday))), freshEveryday, 'A fresh realistic model stays fresh after reopening')
freshEveryday.layerOrder.reverse()
m.resetEveryday(freshEveryday, true)
assert.deepEqual(freshEveryday.everydayPieces, editableEveryday.everydayPieces)
assert.deepEqual(freshEveryday.layerOrder, [...m.LAYERS])
assert.equal(freshEveryday.bag, 'crossbody')
const movedEveryday = m.snapshot(editableEveryday)
movedEveryday.placements.bottom = { x: 55, y: -20, rotation: 12, scale: 0.9, locked: false }
movedEveryday.layerOrder = ['main', 'shoes', 'bag', 'bottom', 'outer', 'accessories', 'headwear']
const movedEverydayMarkup = m.renderIllustration(movedEveryday)
assert.ok(movedEverydayMarkup.includes(m.placementTransform('bottom', movedEveryday.placements.bottom)), 'Raster clothing keeps the shared placement transform')
assert.ok(movedEverydayMarkup.indexOf('data-layer="bottom"') < movedEverydayMarkup.indexOf('data-layer="shoes"'), 'Styled-with shoes stay fixed after the model layers while garments keep the chosen order')
assert.notEqual(m.fabricTargetFingerprint(editableEveryday), m.fabricTargetFingerprint(everydayVariants), 'Authored garment variants affect the fabric specification')
assert.equal(m.parseLook({ ...m.DEFAULT_LOOK, wardrobeArt: 'unsupported' }).wardrobeArt, 'none', 'Unknown wardrobe art falls back safely')
for (const headStyle of ['wrap', 'gele', 'fila']) {
  const head = m.renderIllustration(m.parseLook({ ...m.DEFAULT_LOOK, headwear: true, headStyle }))
  assert.ok(head.includes('clipPath id="headwearDetailClip"'), `Headwear details remain inside ${headStyle}`)
}
assert.ok(svg.indexOf('data-sketch-underlay') < svg.indexOf('data-line='))
assert.ok(svg.includes('opacity="0.4"'))
assert.ok(svg.includes('filter:contrast(1)') && svg.includes('preserveAspectRatio="xMidYMid meet"'))
assert.equal(
  m.parseLook({ ...look, sketchUnderlay: { image: 'https://example.com/tracker.png' } })
    .sketchUnderlay,
  null
)
assert.equal(
  m.parseLook({ ...look, sketchUnderlay: { image, opacity: Infinity } }).sketchUnderlay.opacity,
  0.4
)
assert.equal(
  m.parseLook({ ...look, sketchUnderlay: { image, opacity: 9 } }).sketchUnderlay.opacity,
  1
)
assert.equal(m.parseLook({ ...look, sketchUnderlay: { image, contrast: 99, framing: 'fill' } }).sketchUnderlay.contrast, 1.8)
assert.ok(m.renderIllustration(m.parseLook({ ...look, sketchUnderlay: { image, contrast: 1.4, framing: 'fill' } })).includes('preserveAspectRatio="xMidYMid slice" style="filter:contrast(1.4)"'))
const hidden = m.renderIllustration({
  ...look,
  sketchUnderlay: { ...look.sketchUnderlay, visible: false },
})
assert.ok(!hidden.includes('data-sketch-underlay'))
assert.ok(hidden.includes('data-line='))
assert.equal(m.parseLook({ ...m.DEFAULT_LOOK, sketchUnderlay: undefined }).sketchUnderlay, null)
assert.throws(() => m.parseSavedLooks(Array(13).fill(look)))
assert.throws(() => m.studioStorageKey('../other-user'))
assert.notEqual(m.studioStorageKey('customer-1'), m.studioStorageKey('tailor-1'))
assert.notEqual(m.studioDraftKey('customer-1'), m.studioDraftKey('tailor-1'))
assert.throws(() => m.parseSavedLooks([{ version: 99 }]))
assert.deepEqual(m.parseStudioCollection({ revision: 0, looks: [] }), { revision: 0, looks: [] })
assert.throws(() => m.parseStudioCollection({ revision: -1, looks: [] }))
const remoteLook = m.parseLook({ ...m.DEFAULT_LOOK, name: 'Same name', colour: '#123456' })
const deviceLook = m.parseLook({ ...m.DEFAULT_LOOK, name: 'Same name', colour: '#654321' })
const reconciled = m.mergeStudioCollections([remoteLook], [deviceLook])
assert.equal(reconciled.looks[0].colour, '#123456')
assert.equal(reconciled.looks[1].name, 'Same name (device copy)')
assert.equal(reconciled.looks[1].colour, '#654321')
assert.equal(reconciled.recoveredCopies, 1)
assert.equal(m.mergeStudioCollections([remoteLook], [remoteLook]).recoveredCopies, 0)
assert.equal(m.mergeStudioCollections(Array(12).fill(remoteLook), [deviceLook]).omittedCopies, 1)
const sourcedColours = m.fabricColourRows(m.parseLook({ ...m.DEFAULT_LOOK, outfit: 'dress', headwear: true, bag: 'clutch', earrings: true }))
assert.ok(sourcedColours.some((row) => row.label === 'Main fabric'))
assert.ok(sourcedColours.some((row) => row.label === 'Headwear'))
assert.ok(!sourcedColours.some((row) => ['Footwear', 'Bag', 'Fan', 'Metal / details'].includes(row.label)))
assert.deepEqual(m.fabricColourRows(look), [])
const referenceLook = m.parseLook({ ...look, reference: { image, sourceUrl: '', keep: '', change: '', palette: ['#ba7d86', '#23766b'] } })
assert.deepEqual(m.colourRows(referenceLook).map((row) => row.label), ['Reference colour 1', 'Reference colour 2', 'Sketch colour 1'])
assert.ok(m.colourRows(referenceLook)[0].name.includes('not approved fabric'))
assert.match(m.renderTransferNotes(referenceLook), /REFERENCE COLOURS — sampled from inspiration, not approved fabric/)
const referenceSheet = m.renderLookSheet(referenceLook, m.renderIllustration(referenceLook))
assert.match(referenceSheet, /Reference colour 1: Sampled from inspiration photo · not approved fabric \/ #BA7D86/)
assert.match(referenceSheet, /REFERENCE COLOURS — confirm fabric separately/)
const handoffNotes = m.briefHandoffNotes(referenceLook)
for (const detail of ['Reference colours: Reference colour 1 (sampled from inspiration photo · not approved fabric) #BA7D86', 'Keep: Sleeves', 'Change: Longer hem', 'Remove: Belt', 'Confirm with tailor: Fabric swatch']) assert.ok(handoffNotes.includes(detail), `Brief handoff must include ${detail}`)
assert.ok(m.briefHandoffNotes(m.parseLook({ ...referenceLook, canvasMode: 'figure', outfit: 'dress' })).includes('Reference colours:'), 'Source colours remain distinct from garment colours in the brief handoff')
const fabricBase = m.parseLook({ ...m.DEFAULT_LOOK, outfit: 'dress', bag: 'clutch' })
assert.equal(m.fabricTargetFingerprint(fabricBase), m.fabricTargetFingerprint(m.parseLook({ ...fabricBase, bagColour: '#123456', shoeColour: '#654321', pose: 'open' })))
assert.notEqual(m.fabricTargetFingerprint(fabricBase), m.fabricTargetFingerprint(m.parseLook({ ...fabricBase, colour: '#123456' })))
assert.notEqual(m.fabricTargetFingerprint(fabricBase), m.fabricTargetFingerprint(m.parseLook({ ...fabricBase, pattern: 'woven' })))
const handoffLook = m.parseLook({
  ...m.DEFAULT_LOOK,
  name: 'Customer occasion look',
  outfit: 'dress',
  colourNames: { colour: 'Muted rose' },
  directions: { keep: 'Neckline from reference', change: 'Longer sleeves', remove: 'Belt', confirm: 'Fabric swatch' },
})
const sheet = m.renderLookSheet(handoffLook, m.renderIllustration(handoffLook))
const notes = m.renderTransferNotes(handoffLook)
for (const detail of ['Neckline from reference', 'Longer sleeves', 'Fabric swatch', 'Muted rose']) {
  assert.ok(sheet.includes(detail), `Design sheet must explain ${detail}`)
  assert.ok(notes.includes(detail), `Text directions must explain ${detail}`)
}
assert.ok(!sheet.includes('Local draft'))
assert.ok(!notes.includes('no order has been sent'))
for (const figure of ['feminine', 'masculine'])
  for (const body of ['slim', 'balanced', 'full'])
    for (const outfit of ['dress', 'separates', 'agbada', 'jumpsuit'])
      for (const pose of ['resting', 'open', 'hand-hip']) {
        const result = m.renderIllustration(
          m.parseLook({ ...m.DEFAULT_LOOK, figure, body, outfit, pose, bag: 'shoulder' })
        )
        assert.ok(
          result.includes('data-neutral-cover="true" visibility="visible"'),
          `The modest base layer must remain visible beneath outfit gaps (${figure}/${body}/${outfit}/${pose})`
        )
        assert.ok(
          !/NaN|undefined/.test(result.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, ''))
        )
      }
assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(m.renderIllustration({...m.DEFAULT_LOOK,earrings:true})), 'Exported accessory labels must be valid XML');
const activeHtml = await readFile(new URL('studio-sketch.html', import.meta.url), 'utf8')
for (const required of ['id="canvas"', 'id="lookSearch"', 'id="lookGroup"', 'Upload paper sketch', 'Add reference photo', 'Directions for your tailor', 'Attach sketch to brief']) assert.ok(activeHtml.includes(required), `Active sketch editor needs ${required}`)
for (const removed of ['id="pieceBar"', 'id="figureGeometry"', 'id="arrangeToggle"', 'Start with a shape', 'data-room="figure"']) assert.ok(!activeHtml.includes(removed), `Active sketch editor must omit ${removed}`)
const sketchLook = m.parseLook({...m.DEFAULT_LOOK,canvasMode:'paper',wardrobeArt:'none',outfit:'blank',inspirationLook:'teal-occasion',lookPalette:['#075c50'],directions:{keep:'Keep puff sleeves',change:'Longer hem',remove:'Remove belt',confirm:'Approve silk swatch'}})
const sketchSheet = m.renderSketchSheet(sketchLook,'<path d="M1 1L2 2"/>')
assert.ok(sketchSheet.includes('DRAPEON / STUDIO SKETCH') && sketchSheet.includes('Teal occasion') && sketchSheet.includes('Keep puff sleeves'))
assert.ok(m.briefHandoffNotes(sketchLook).includes('Look colour 1 (sampled from look reference · not approved fabric) #075C50'))
console.log(
  'Studio checks passed: active sketch editor, reference bank sheet, structured brief handoff, legacy import and storage; archived figure rendering remains parseable.'
)

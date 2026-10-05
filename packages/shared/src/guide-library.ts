/** Public, versioned editorial content. No customer data or executable markup. */
export type GuideCategory =
  | 'Studio'
  | 'Vision'
  | 'Measurements'
  | 'Ordering'
  | 'For tailors'
  | 'Clothing care'
export type GuideArticle = {
  id: string
  version: number
  title: string
  summary: string
  category: GuideCategory
  tags: string[]
  minutes: number
  illustration: 'sleeve' | 'body' | 'fabric' | 'care' | 'design'
  sections: { id: string; title: string; body: string }[]
  mistakes: string
  sources: { title: string; url: string }[]
  related: string[]
}
export const GUIDE_CATEGORIES: GuideCategory[] = [
  'Studio',
  'Vision',
  'Measurements',
  'Ordering',
  'For tailors',
  'Clothing care',
]
export const GUIDE_UPDATED = '2026-09-30'
const source = {
  measure: {
    title: 'Seamwork: taking body measurements',
    url: 'https://www.seamwork.com/articles/how-to-take-your-measurements',
  },
  sizes: {
    title: 'Simplicity: measurement and size charts',
    url: 'https://simplicity.com/size-charts/',
  },
  care: {
    title: 'GINETEX: understanding care labels',
    url: 'https://www.ginetex.net/GB/labelling/care-symbols.asp',
  },
  textile: {
    title: 'Canadian Conservation Institute: textiles and costumes',
    url: 'https://www.canada.ca/en/conservation-institute/services/preventive-conservation/guidelines-collections/textiles-costumes.html',
  },
  wool: { title: 'Woolmark: wool care', url: 'https://www.woolmark.com/care/' },
}
function article(
  id: string,
  category: GuideCategory,
  title: string,
  summary: string,
  illustration: GuideArticle['illustration'],
  tags: string[],
  steps: [string, string][],
  mistakes: string,
  sources: GuideArticle['sources'] = [],
  related: string[] = []
): GuideArticle {
  return {
    id,
    version: 1,
    category,
    title,
    summary,
    illustration,
    tags,
    minutes: Math.max(
      2,
      Math.ceil(
        steps
          .map((s) => s.join(' '))
          .join(' ')
          .split(' ').length / 150
      )
    ),
    sections: steps.map(([title, body], i) => ({ id: `step-${i + 1}`, title, body })),
    mistakes,
    sources,
    related,
  }
}
export const GUIDE_ARTICLES: GuideArticle[] = [
  article(
    'studio-first-look',
    'Studio',
    'Your first look in Studio',
    'Turn an idea into a design you can explain.',
    'design',
    ['sketch', 'design', 'beginner'],
    [
      [
        'Choose a starting point',
        'Start with a wardrobe look, your own reference, or a blank space. Choose a figure if it helps you picture the outfit; you can also work without one.',
      ],
      [
        'Change one piece at a time',
        'Select the garment or accessory you want to change. Adjust the shape, sleeves, colours and details. Moving a piece expresses your idea; it does not prove how the finished garment will fit.',
      ],
      [
        'Save and explain',
        'Give the look a recognisable name. Add what to keep and what to change before attaching it to a brief. Your tailor still confirms fabric, measurements and construction.',
      ],
    ],
    'A beautiful picture alone does not explain which details matter most.',
    [],
    ['reference-photos', 'colour-and-fabric']
  ),
  article(
    'sketch-to-brief',
    'Studio',
    'Bring a photo or sketch you already have',
    'Use your existing work without having to redesign it.',
    'design',
    ['upload', 'drawing', 'reference'],
    [
      [
        'Choose the right route',
        'In a brief, choose Upload a photo or sketch to attach your file directly. Choose a saved Studio look if you have already made one. Open Studio when you want to edit or assemble an idea.',
      ],
      [
        'Make the important parts readable',
        'Use a clear image. Include a separate close-up when a seam, sleeve or embroidery detail is too small to understand. Label front and back views when both are available.',
      ],
      [
        'Describe the change',
        'Write a short instruction for each important reference: keep this neckline, lengthen this sleeve, use a different colour. Tell the tailor which picture takes priority if references disagree.',
      ],
    ],
    'Uploading an inspiration photo does not automatically turn it into an editable garment.',
    [],
    ['reference-photos', 'studio-first-look']
  ),
  article(
    'colour-and-fabric',
    'Studio',
    'Explain a colour and confirm the fabric',
    'Carry your colour idea through to a real swatch.',
    'fabric',
    ['hex', 'colour', 'color', 'swatch', 'sourcing'],
    [
      [
        'Name the colour',
        'Save a plain-language description such as muted dusty rose alongside the colour code. Say which piece uses it and whether a close match is acceptable.',
      ],
      [
        'Explain the material',
        'Describe the weight, stretch, opacity, surface and drape you want. A colour code cannot specify any of these qualities. If you have a sample, discuss how the tailor can compare it.',
      ],
      [
        'Approve the actual proposal',
        'Ask for the proposed fabric or swatch through the order conversation. Review it in the fabric approval flow before the tailor proceeds. Screens and lighting can change how the same material appears.',
      ],
    ],
    'Do not treat a sampled photo colour or hex code as a guaranteed dye match.',
    [],
    ['fabric-approval', 'reference-photos']
  ),
  article(
    'vision-prepare',
    'Vision',
    'Prepare for Drapeon Vision',
    'Give the measurement workflow a clearer starting point.',
    'body',
    ['camera', 'scan', 'lighting'],
    [
      [
        'Prepare the space',
        'Use the on-screen framing and lighting instructions. Make room to stand comfortably and keep the camera steady. Avoid a background that makes your outline hard to see.',
      ],
      [
        'Follow the current capture instructions',
        'Wear the clothing recommended in the capture screen and follow its pose guidance. Pause if you cannot hold the requested position comfortably. Do not guess your way past a rejected capture.',
      ],
      [
        'Review before reusing',
        'Check the returned measurements and any warnings. Retake a poor capture or use the manual measurement route. Share fit preferences separately from measurements.',
      ],
    ],
    'Vision results are fit context to review, not a promise that every garment will fit.',
    [],
    ['measure-yourself', 'body-versus-garment']
  ),
  article(
    'measure-yourself',
    'Measurements',
    'Measure yourself with confidence',
    'A calm setup for repeatable body measurements.',
    'body',
    ['adult', 'tape', 'cm', 'inches'],
    [
      [
        'Get ready',
        'Use a flexible, non-stretch tape and a mirror. Wear close-fitting clothing and stand naturally. Check the tape starts at zero.',
      ],
      [
        'Measure without squeezing',
        'Keep circumference measurements level. Measure the fullest chest or bust, natural waist and fullest hips. Breathe normally.',
      ],
      [
        'Check and record',
        'Repeat each measurement. Record centimetres or inches explicitly, the date, and any uncertainty. Ask for help with hard-to-reach measurements.',
      ],
    ],
    'Do not add garment looseness to a body measurement.',
    [source.measure],
    ['measure-someone', 'body-versus-garment']
  ),
  article(
    'measure-someone',
    'Measurements',
    'Help someone take their measurements',
    'A comfortable, collaborative fitting session.',
    'body',
    ['helper', 'adult', 'assistance', 'accessibility'],
    [
      [
        'Agree what is needed',
        'Ask which measurements the tailor needs and explain each step before touching or placing the tape. The person can pause or stop at any point.',
      ],
      [
        'Keep the setup consistent',
        'Let them stand or sit in a comfortable position. Tell the tailor if measurements were taken seated or with another adaptation so the intended fit can be discussed.',
      ],
      [
        'Read together',
        'Check that the tape is level for circumferences and follows the requested landmarks for lengths. Read the value aloud and record units. Repeat anything uncertain.',
      ],
    ],
    'Do not pull the tape tighter to make the numbers look more consistent.',
    [],
    ['sleeve-measurement', 'measure-yourself']
  ),
  article(
    'sleeve-measurement',
    'Measurements',
    'Measure a sleeve with a helper',
    'Agree the endpoints before reading the tape.',
    'sleeve',
    ['arm', 'sleeve', 'helper', 'length'],
    [
      [
        'Confirm the method',
        'Ask whether the tailor wants body arm length or a finished sleeve length. Ask them to identify the start and end points; dropped shoulders and other sleeve styles can use different construction references.',
      ],
      [
        'Position the arm',
        'For a shoulder-to-wrist body measurement, keep the shoulder relaxed and the elbow slightly bent. Have a helper follow the outer arm over the elbow to the agreed wrist point.',
      ],
      [
        'Record and explain',
        'Repeat once and record units. State the method used. Describe a shorter or longer finished sleeve separately rather than changing the body measurement.',
      ],
    ],
    'Do not substitute a shirt sleeve measurement without telling your tailor.',
    [],
    ['measure-someone', 'body-versus-garment']
  ),
  article(
    'measure-children',
    'Measurements',
    'A parent or caregiver measures a child',
    'Keep it short, comfortable and up to date.',
    'body',
    ['kids', 'children', 'school', 'parent'],
    [
      [
        'Use current measurements',
        'Choose the pattern or tailor’s required measurements rather than relying on age or a shop size alone. A caregiver should help.',
      ],
      [
        'Measure comfortably',
        'Use a flexible tape over light clothing. Keep it level for chest, waist and hips without tightening. Stop for a break when needed.',
      ],
      [
        'Discuss growth separately',
        'Record the date and units. Tell the tailor the intended wear date and ask about growth allowance; do not silently add it to body measurements.',
      ],
    ],
    'No body photo is needed for this guide. Remeasure if the child has grown before cutting.',
    [source.sizes],
    ['body-versus-garment', 'measure-someone']
  ),
  article(
    'body-versus-garment',
    'Measurements',
    'Body size, garment size and ease',
    'Understand which number you are sending.',
    'fabric',
    ['fit', 'ease', 'size', 'units'],
    [
      [
        'Label the measurement',
        'A body measurement describes the person. A finished garment measurement describes the clothing. Write which one you are providing.',
      ],
      [
        'Discuss ease',
        'Ease is room or stretch built into the garment. The needed amount depends on fabric and design. Your tailor should determine it from the agreed fit.',
      ],
      [
        'Keep units consistent',
        'One inch is 2.54 centimetres. Do not mix unit systems in an unlabelled list. Pattern sizing may differ from ready-made shop sizing.',
      ],
    ],
    'A size label alone is not a full fit specification.',
    [source.sizes],
    ['measure-yourself', 'sleeve-measurement']
  ),
  article(
    'reference-photos',
    'Ordering',
    'Tell your tailor what each reference means',
    'Keep the neckline. Change the sleeve. Make the request clear.',
    'design',
    ['brief', 'keep', 'change', 'photos'],
    [
      [
        'Choose a main reference',
        'Identify the overall look you are asking for. Add detail photos only where they clarify something the main image cannot show.',
      ],
      [
        'Separate keep from change',
        'For each image, explain which details to keep and which to change. Use concrete terms: colour, silhouette, length, sleeve, neckline, closure, lining, embellishment, coverage, pockets, fit and fabric behaviour.',
      ],
      [
        'Resolve contradictions',
        'If two references disagree, tell the tailor which detail wins. Keep the agreed explanation in the order conversation so both people can return to it.',
      ],
    ],
    'Do not assume a tailor knows which part of a reference you liked.',
    [],
    ['sketch-to-brief', 'fabric-approval']
  ),
  article(
    'fabric-approval',
    'Ordering',
    'Review a fabric proposal',
    'Check the material as well as its colour.',
    'fabric',
    ['swatch', 'approval', 'sourcing', 'lining'],
    [
      [
        'Ask for the important evidence',
        'Check the proposed fabric, colour, composition where known, weight and opacity. Ask about stretch, lining and care if those affect the design.',
      ],
      [
        'Raise changes before approval',
        'Explain what is unsuitable and what would work better. A saved colour code is a target, not confirmation that the proposed cloth matches.',
      ],
      [
        'Use the order decision',
        'Record your decision through the available fabric approval action. Keep unresolved questions visible rather than treating silence as approval.',
      ],
    ],
    'A fabric photograph alone may not show how the material moves or feels.',
    [],
    ['colour-and-fabric', 'care-labels']
  ),
  article(
    'tailor-clarify',
    'For tailors',
    'Clarify a brief before cutting',
    'Turn inspiration into an agreed instruction.',
    'design',
    ['tailor', 'approval', 'revision', 'cutting'],
    [
      [
        'Read the intended differences',
        'Review the main reference, the keep/change notes and the latest shared Studio version. Call out details that conflict with the fabric, budget or construction.',
      ],
      [
        'Ask a focused question',
        'Send the relevant guide or a specific guide section with a personal note. Ask one clear question: for example, whether the customer means body arm length or finished sleeve length.',
      ],
      [
        'Record the agreed version',
        'Use the order’s style approval and fabric approval actions when applicable. A revised image or guide message does not itself mean the customer approved cutting.',
      ],
    ],
    'Keep superseded versions as history, not competing active instructions.',
    [],
    ['reference-photos', 'sleeve-measurement']
  ),
  article(
    'tailor-guide-collections',
    'For tailors',
    'Build a guide collection for customers',
    'Prepare the instructions you send most often.',
    'design',
    ['collections', 'saved', 'share'],
    [
      [
        'Save useful lessons',
        'Open a guide and choose Save. Your signed-in library syncs across devices; any pending sync is shown so you know when it still needs a connection.',
      ],
      [
        'Group a few lessons',
        'Create a collection such as Before your fitting. Add only the guides that matter for that task and arrange them in reading order.',
      ],
      [
        'Send with context',
        'Choose Send a guide in the order conversation. Select the guide or collection, add your own note in the message draft and send when ready.',
      ],
    ],
    'A short relevant collection is easier to use than a large list with no explanation.',
    [],
    ['tailor-clarify', 'measure-someone']
  ),
  article(
    'care-labels',
    'Clothing care',
    'Start with the care label',
    'Choose care by material and construction, wherever a garment comes from.',
    'care',
    ['washing', 'labels', 'cotton', 'silk', 'linen', 'worldwide'],
    [
      [
        'Read before washing',
        'Check the garment’s care instructions before choosing a method. Fibre, dye, lining and trims can each affect what is suitable.',
      ],
      [
        'Understand the symbols',
        'Care labels describe washing, bleaching, drying, ironing and professional care. A crossed-out symbol prohibits that treatment. Use the linked GINETEX reference to interpret unfamiliar symbols.',
      ],
      [
        'When instructions are missing',
        'Ask the maker or a textile-care professional before treating an unfamiliar or valuable garment. Its regional name or appearance does not identify its full material composition.',
      ],
    ],
    'Do not assume all cotton, silk or printed garments can receive the same treatment.',
    [source.care],
    ['embellished-clothing', 'wool-care']
  ),
  article(
    'embellished-clothing',
    'Clothing care',
    'Care for embroidery, beads and special garments',
    'Protect details on occasionwear and everyday favourites.',
    'care',
    ['agbada', 'sari', 'lehenga', 'abaya', 'kimono', 'gown', 'beads', 'embroidery'],
    [
      [
        'Inspect the whole garment',
        'Check the lining, trims, metallic threads and fastenings as well as the outer fabric. Ask the maker about special care and follow the care label.',
      ],
      [
        'Support delicate areas',
        'Avoid pulling on decorative threads or hanging heavy garments in a way that strains them. Protect embellishments from snagging against neighbouring clothes.',
      ],
      [
        'Store with care',
        'Keep garments clean and dry in a suitable storage space, away from strong light and moisture. Seek specialist advice for fragile, historic or valuable pieces.',
      ],
    ],
    'Museum conservation advice is useful context, but it is not a washing recipe for every modern garment.',
    [source.textile],
    ['care-labels', 'clothing-storage']
  ),
  article(
    'clothing-storage',
    'Clothing care',
    'Store clothes between wears',
    'Think about weight, light, moisture and space.',
    'care',
    ['humidity', 'storage', 'travel', 'wardrobe'],
    [
      [
        'Choose support',
        'Avoid stressing shoulders or decorated areas. Fold pieces that would stretch under their own weight and use suitable hangers for garments that can be hung.',
      ],
      [
        'Check the environment',
        'Protect textiles from prolonged strong light, damp conditions and pests. Make sure a garment is dry before putting it away.',
      ],
      [
        'Inspect occasionally',
        'Look for damp, pests, weakened fabric or snagged details before a problem spreads. Ask a specialist about valuable or fragile clothing.',
      ],
    ],
    'Storage needs depend on the garment and environment, not just the calendar season.',
    [source.textile],
    ['embellished-clothing', 'care-labels']
  ),
  article(
    'wool-care',
    'Clothing care',
    'Care for wool and knitwear',
    'Follow the garment’s instructions and protect its shape.',
    'care',
    ['wool', 'knitwear', 'sweater', 'washing'],
    [
      [
        'Check the label',
        'Some wool garments permit machine washing; others need hand washing or professional care. Choose the method specified for your garment.',
      ],
      [
        'Use the indicated treatment',
        'Follow the recommended programme and detergent guidance. Do not assume a hotter or more vigorous wash will be better.',
      ],
      [
        'Dry as directed',
        'Support the garment’s shape and follow its drying instructions. Refer to Woolmark’s detailed guidance for the type of treatment your label allows.',
      ],
    ],
    'A wool blend or decorated knit can need different care from a plain wool garment.',
    [source.wool],
    ['care-labels', 'clothing-storage']
  ),
]
export function getGuide(id: string) {
  return GUIDE_ARTICLES.find((g) => g.id === id)
}
export function searchGuides(query: string, category?: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return GUIDE_ARTICLES.filter(
    (g) =>
      (!category || g.category === category) &&
      words.every((w) =>
        `${g.title} ${g.summary} ${g.tags.join(' ')} ${g.sections.map((s) => s.body).join(' ')}`
          .toLocaleLowerCase()
          .includes(w)
      )
  )
}
export function guideReference(id: string, section?: string) {
  const guide = getGuide(id)
  if (!guide || (section && !guide.sections.some((s) => s.id === section)))
    throw Error('Unknown guide or section')
  return `[Drapeon guide: ${id}${section ? '#' + section : ''}]`
}
export function parseGuideReferences(body: string) {
  const matches = [...body.matchAll(/\[Drapeon guide: ([a-z0-9-]+)(?:#(step-\d+))?\]/g)]
  return matches
    .flatMap((m) => {
      const guide = getGuide(m[1] || '')
      const section = m[2]
      return guide && (!section || guide.sections.some((s) => s.id === section))
        ? [{ guide, section, token: m[0] }]
        : []
    })
    .slice(0, 8)
}
export function guideDraftText(body: string) {
  return parseGuideReferences(body)
    .reduce((text, reference) => text.replace(reference.token, ''), body)
    .trim()
}
export function updateGuideDraftText(body: string, text: string) {
  const references = parseGuideReferences(body).map((reference) => reference.token)
  return [text.trimEnd(), ...references].filter(Boolean).join('\n\n')
}
export function removeGuideDraftReference(body: string, token: string) {
  const references = parseGuideReferences(body)
    .filter((reference) => reference.token !== token)
    .map((reference) => reference.token)
  return [guideDraftText(body), ...references].filter(Boolean).join('\n\n')
}
export function guideShareText(ids: string[]) {
  return [...new Set(ids)]
    .slice(0, 8)
    .map((id) => guideReference(id))
    .join('\n')
}
export function guidePublicUrl(id: string, section?: string) {
  return `https://drapeon.co/guide/${getGuide(id) ? id : ''}${section ? '#' + section : ''}`
}

/** Rooms group lessons; article IDs remain stable for saved items and message links. */
export const GUIDE_ROOMS = [
  {
    category: 'Studio',
    title: 'Studio guide',
    description: 'Build a look, work from a sketch and explain every detail.',
    topics: 'Starting a look · References · Colour & fabric',
  },
  {
    category: 'Vision',
    title: 'Vision guide',
    description: 'Prepare for a scan and understand your measurement workflow.',
    topics: 'Preparation · Capture · Reviewing results',
  },
  {
    category: 'Measurements',
    title: 'Measurement guide',
    description: 'Follow along yourself, with a helper, or as a parent or caregiver.',
    topics: 'Self measuring · Helping someone · Children · Fit & ease',
  },
  {
    category: 'Ordering',
    title: 'Ordering guide',
    description: 'Turn your idea into a clear brief and make decisions with your tailor.',
    topics: 'References · Fabric approval',
  },
  {
    category: 'For tailors',
    title: 'Tailor guide',
    description: 'Clarify the brief and send useful instructions to your customers.',
    topics: 'Before cutting · Sharing lessons · Collections',
  },
  {
    category: 'Clothing care',
    title: 'Clothing care guide',
    description: 'Care for clothes by their fabric and construction, wherever they come from.',
    topics: 'Care labels · Embellishments · Storage · Knitwear',
  },
] satisfies { category: GuideCategory; title: string; description: string; topics: string }[]
export type GuideVideo = {
  youtubeId: string
  title: string
  creator: string
  description: string
  sourceUrl: string
}
const measuringVideo: GuideVideo = {
  youtubeId: 'oOQMeXW8ewc',
  title: 'How to measure for dressmaking',
  creator: 'Made to Sew',
  description:
    'A demonstration of body, arm and leg measurements with a helper. Confirm the measurements your tailor needs before starting.',
  sourceUrl: 'https://www.youtube.com/watch?v=oOQMeXW8ewc',
}
export const GUIDE_VIDEOS: Record<string, GuideVideo> = {
  'measure-yourself': {
    youtubeId: '877feE8WHyw',
    title: 'How to take body measurements',
    creator: 'Seamwork',
    description:
      'A practical introduction to essential body measurements. Use a helper for places you cannot reach comfortably.',
    sourceUrl:
      'https://www.seamwork.com/sewing-tutorials/video-tutorial-how-to-take-body-measurements',
  },
  'measure-someone': measuringVideo,
  'sleeve-measurement': measuringVideo,
  'measure-children': {
    youtubeId: '0KHbWm2qajk',
    title: 'How to measure kids for sewing clothing',
    creator: 'Melly Sews',
    description:
      'A parent or caregiver can follow this demonstration, pausing as needed. Keep the child comfortable and record the date.',
    sourceUrl: 'https://mellysews.com/how-to-measure-kids-sew-clothes/',
  },
  'body-versus-garment': {
    youtubeId: 'HL0H1kaLahE',
    title: 'Understanding ease',
    creator: 'Seamwork',
    description:
      'Learn how body measurements and the room in a finished garment relate to each other.',
    sourceUrl:
      'https://www.seamwork.com/sewing-tutorials/video-tutorial-how-to-take-body-measurements',
  },
}

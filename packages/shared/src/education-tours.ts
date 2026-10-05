export type EducationTour = 'welcome' | 'studio' | 'vision' | 'brief'
export const EDUCATION_TOURS: Record<
  EducationTour,
  { title: string; guide: string; steps: { title: string; body: string; target?: string }[] }
> = {
  welcome: {
    title: 'Find your way around Drapeon',
    guide: 'reference-photos',
    steps: [
      {
        title: 'Tools when you need them',
        body: 'Use Studio to explain an outfit, Vision for measurement workflows, and Guide for practical instructions.',
        target: 'education-tools',
      },
      {
        title: 'Keep decisions with the order',
        body: 'References, messages and approvals belong to the same order. You can send a guide there when a detail needs explaining.',
      },
      {
        title: 'Come back whenever you need',
        body: 'Save lessons in Guide, group them into collections, and replay these introductions from Guide. Skipping never prevents you using Drapeon.',
      },
    ],
  },
  studio: {
    title: 'A quick introduction to Studio',
    guide: 'studio-first-look',
    steps: [
      {
        title: 'Choose your starting point',
        body: 'Use a look, your own image, or a blank space. An existing photo can also go directly into a brief.',
        target: 'studio-editor',
      },
      {
        title: 'Explain the changes',
        body: 'Work one piece at a time. Keep the colour name, colour code and the details you want to change together.',
      },
      {
        title: 'Save before sharing',
        body: 'Give your look a name and attach the saved version to your brief. Your tailor confirms fit and construction.',
      },
    ],
  },
  vision: {
    title: 'Before your measurement capture',
    guide: 'vision-prepare',
    steps: [
      {
        title: 'Prepare your space',
        body: 'Follow the capture screen’s lighting, framing and clothing instructions.',
      },
      {
        title: 'Review the result',
        body: 'Check warnings and uncertain measurements. Retake or use the manual route when needed.',
      },
      {
        title: 'Help stays available',
        body: 'Guide includes measuring yourself, helping another adult, and caregiver-led measurements for children.',
      },
    ],
  },
  brief: {
    title: 'Explain your idea clearly',
    guide: 'reference-photos',
    steps: [
      {
        title: 'Bring what you have',
        body: 'Upload a photo or sketch directly, select a saved Studio look, or create a new one.',
        target: 'brief-references',
      },
      {
        title: 'Keep this, change that',
        body: 'Say what each image contributes. Point out conflicting details before asking your tailor to proceed.',
      },
      {
        title: 'Confirm the material',
        body: 'Pair a colour name with its code. The actual fabric or swatch still needs confirmation.',
      },
    ],
  },
}

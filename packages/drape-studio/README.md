# Drapeon Studio

Studio is a shared sketch pad for the web editor and React Native WebView. It helps a customer or tailor communicate design intent with marks, references, colour samples and structured directions. It does not claim to simulate fit or produce a sewing pattern.

Run `pnpm studio:build` after changing this package. The build writes the same HTML document to `dist/studio-document.json` and `apps/mobile/assets/studio/studio-document.json`. Run `pnpm studio:check` for package type and contract checks.

## Current editor

- `studio-sketch.html`, `studio-sketch.css` and `src/studio-sketch-app.ts` are the active editor. There is no figure, clothing piece inspector or arrangement mode in its bundle.
- A paper sketch becomes a bounded JPEG underlay with visibility, opacity, contrast and fit/crop controls. Pen and arrow marks remain separate and editable through undo, redo and clear.
- An uploaded photo stays beside the pad for colour and mood. Tapping it samples a reference colour. Looks is a collapsed, searchable reference bank; choosing one places a small card beside the pad and does not alter the drawing. Cultural clothing currently includes agbada, a teal gown with gele, an adire bùbá and ìró ensemble, and a sari drape.
- Keep, Change, Remove and Confirm together directions are saved as structured fields. The look sheet includes the sketch, references, sampled colours and directions. Sampled screen colours are labelled as references until a real fabric swatch is approved.
- The host owns account-scoped draft and collection storage. Web uses a sandboxed iframe and native uses WebView messaging. The same bridge attaches a PNG sheet and design record to a customer brief, sends a revised order design, or sends a tailor style plan.
- Older figure-mode saved looks remain parseable. Opening one in the active editor converts its prior wardrobe choice into a reference card where possible and keeps any sketch, uploaded photo and directions. The old figure composition is not rendered or editable.

## Release checks still needed

Exercise file upload, drawing, named save, draft recovery, review sheet and brief/order handoff on physical Android and iOS devices. Verify a tailor can understand the received sheet and directions without explanation before freezing the order contract. The parked try-on engine is separate from Studio.

# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Drapeon Web
**Status:** Canonical Drapeon direction; runtime parity is tracked separately.
**Last reviewed:** 2026-09-15

---

## Sources of truth

- Shared implementation tokens: `packages/shared/src/design-system.ts` and
  `packages/shared/src/constants.ts`.
- Product foundation and accessibility rules: `docs/design-foundation.md`.
- Brand, lifecycle, conversion, consent, and proof rules: [Drapeon Brand, Relationship, and
  Lifecycle System](/Users/onaopemipodimowo/Documents/Codex/2026-09-15/i-a/outputs/drapeon-brand-relationship-and-lifecycle-system.md).
- Release gates: [Production Delivery Guardrails](/Users/onaopemipodimowo/Documents/Codex/2026-09-15/i-a/outputs/production-delivery-guardrails-design.md).

If a generated reference disagrees with these sources, record the discrepancy and use the
canonical tokens rather than copying the stale reference.

## External primitive policy

[`Atharvsinh-codez/ObsidianUI`](https://github.com/Atharvsinh-codez/ObsidianUI) may be consulted for
web interaction primitives only. Confirm its MIT license and retain attribution for copied source;
copy primitives into Drapeon-owned components, pin the reviewed revision, and restyle them with the
canonical tokens. Do not import its purple/black palette, liquid-glass identity, cursor/magnetic
effects, WebGL/shaders, 3D interactions, or runtime dependency. Any borrowed primitive must pass
the browser/device, accessibility, reduced-motion, happy/negative, no-PII, and evidence checks in
the lifecycle brief.

---

## Global Rules

### Color Palette

| Role          | Hex       | CSS Variable            |
| ------------- | --------- | ----------------------- |
| Primary       | `#2D6A4F` | `--color-primary`       |
| Primary dark  | `#245540` | `--color-primary-dark`  |
| Primary light | `#E8F5EF` | `--color-primary-light` |
| Accent        | `#D85A30` | `--color-accent`        |
| Background    | `#F9F7F3` | `--color-background`    |
| Surface       | `#FFFFFF` | `--color-surface`       |
| Text          | `#2C2C2A` | `--color-text`          |

**Color Notes:** Needle green is the primary action and trust cue. Kanté rust is an accent only;
do not use it for normal body copy or small links unless a contrast check passes.

### Typography

- **Heading Font:** Fraunces
- **Body Font:** Inter
- **Mood:** calm, premium, human, precise, editorial
- **Fallbacks:** system serif for display; system sans for UI/body. Email uses Georgia/Times.

**CSS Import:**

```css
/* Prefer the app's loaded fonts; do not require a remote font for comprehension. */
```

### Spacing Variables

| Token         | Value             | Usage                     |
| ------------- | ----------------- | ------------------------- |
| `--space-xs`  | `4px` / `0.25rem` | Tight gaps                |
| `--space-sm`  | `8px` / `0.5rem`  | Icon gaps, inline spacing |
| `--space-md`  | `16px` / `1rem`   | Standard padding          |
| `--space-lg`  | `24px` / `1.5rem` | Section padding           |
| `--space-xl`  | `32px` / `2rem`   | Large gaps                |
| `--space-2xl` | `48px` / `3rem`   | Section margins           |
| `--space-3xl` | `64px` / `4rem`   | Hero padding              |

### Shadow Depths

| Level         | Value                          | Usage                       |
| ------------- | ------------------------------ | --------------------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`   | Subtle lift                 |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)`    | Cards, buttons              |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)`  | Modals, dropdowns           |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #2d6a4f;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #2d6a4f;
  border: 2px solid #2d6a4f;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #ffffff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #2d6a4f;
  outline: none;
  box-shadow: 0 0 0 3px #2d6a4f20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Calm editorial marketplace

**Keywords:** warm bone canvas, needle green, restrained rust, clear hierarchy, image-led craft,
plainspoken operations, quiet trust cues

**Best For:** Tailor discovery, custom-order journeys, ready-made items, fit context, and durable
order communication

**Key Effects:** Short, purposeful transitions only. Respect reduced motion; do not add liquid glass,
WebGL/shaders, cursor/magnetic effects, or decorative 3D interactions.

### Page Pattern

**Pattern Name:** Marketplace / Directory

- **Conversion Strategy:** Make one clear next action visible, explain what happens next, and use
  real tailor/media context rather than urgency or fake scarcity.
- **CTA Placement:** Contextual primary action with compact secondary paths; tailor identity remains
  visible where the customer is choosing or ordering.
- **Section Order:** 1. Promise, 2. How it works, 3. Tailor/ready-made discovery, 4. Trust and
  support, 5. Clear next step.

---

## Anti-Patterns (Do NOT Use)

- ❌ Vibrant & Block-based
- ❌ Playful colors

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y
- ❌ **Urgency or unsupported promises** — Do not use “hurry,” repeated exclamation marks,
  unsupported “48 hours,” “guaranteed refund,” or internal provider language.
- ❌ **Broken media frames** — Use an intentional placeholder or approved fallback with meaningful
  alt text.

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

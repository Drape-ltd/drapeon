# Drapeon Illustration Inventory

Status: static brand-foundation contract; native replay remains a release gate
Source of truth: [`config/illustration-inventory.json`](/Users/onaopemipodimowo/drape/config/illustration-inventory.json)

The inventory keeps decorative and camera surfaces from silently growing a second Drapeon palette.
Each entry names the surface role, the semantic token or shared anchor it must use, and any literal
color that is intentionally allowed.

## Rules

- Drapeon-owned web illustrations use the shared `illustrationColors` anchors through Tailwind or
  the shared design-system imports.
- Native camera chrome may retain a fixed high-contrast palette so camera controls stay legible in
  every system theme; those literals are listed explicitly and are not a general brand palette.
- Google/Apple/provider marks retain their external identity colors and are listed as exceptions.
- A new literal in an inventoried surface fails `node scripts/illustration-inventory-check.mjs` until
  it is either replaced with a shared anchor or documented with a reason in the inventory.
- Static inventory is not visual proof. The lifecycle brief still requires headed web replay and
  connected iOS/Android replay for every affected surface before promotion.

## Verification

Run:

```sh
node scripts/illustration-inventory-check.mjs
```

The check is part of the release and launch contracts. It reports the exact surface and literal
palette when a new color is introduced, making token drift reviewable before a build.

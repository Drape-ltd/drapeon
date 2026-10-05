-- Per-photo style attribution for custom-order reference photos.
--
-- Today a brief carries up to six reference photos as an undifferentiated array,
-- so a tailor cannot tell which photo is about the neckline and which is only
-- about sleeve length. This column binds the existing style vocabulary
-- (CUSTOM_ORDER_STYLE_ATTRIBUTES) to each individual photo.
--
-- Shape, validated in @drape/shared/reference-photo-attribution:
--   [{ "photo": "<path that also appears in orders.reference_photos>",
--      "attributes": ["Neckline", "Sleeve"],
--      "note": "optional short line" }]
--
-- Purely additive. Existing briefs default to an empty array and no row is
-- rewritten or backfilled. Column-level UPDATE is granted in a separate
-- migration so the schema change and the privilege change stay reviewable apart.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reference_photo_attributions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.orders.reference_photo_attributions IS
  'Per-reference-photo style attribution from the custom-order brief: array of {photo, attributes[], note?}. Sanitized against orders.reference_photos by @drape/shared/reference-photo-attribution before write.';

-- Shape guard only. The database keeps the payload an array and bounds its length
-- to the reference-photo cap (CUSTOM_ORDER_MAX_REFERENCE_PHOTOS = 6); the shared
-- sanitizer enforces the finer rules (known attributes, per-photo cap, note
-- length, deduplication, and that each photo is actually attached to the brief).
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_reference_photo_attributions_shape;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_reference_photo_attributions_shape
  CHECK (
    jsonb_typeof(reference_photo_attributions) = 'array'
    AND jsonb_array_length(reference_photo_attributions) <= 6
  );

-- The web and mobile briefs write attributions only through custom-order-action.
-- 20260929091000 granted direct column UPDATE to every authenticated order
-- participant. Orders RLS permits both customer and tailor updates before a
-- terminal stage, so that grant is broader than the creation workflow needs.
-- Applied migrations are immutable: revoke the unnecessary grant forward.

REVOKE UPDATE (reference_photo_attributions)
  ON TABLE public.orders FROM authenticated;

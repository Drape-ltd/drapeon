-- Extends the orders column-level UPDATE allowlist established in
-- 20260316000002_rls_hardening.sql to cover reference_photo_attributions.
--
-- Kept separate from the schema migration that adds the column so the privilege
-- change can be reviewed on its own.
--
-- This grants nothing beyond that one column. Every restricted column named in
-- the hardening migration (stage, quote and payment fields, escrow, collection
-- codes, dispute and identity columns) stays revoked from `authenticated` and
-- continues to require an Edge Function running as service role. Row ownership
-- is still enforced by the orders RLS policies; a column grant does not bypass
-- them, so a customer can only attribute photos on a brief that is already
-- theirs to update. The existing orders_terminal_guard trigger continues to
-- block edits once an order reaches a terminal stage.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'reference_photo_attributions'
  ) THEN
    EXECUTE 'GRANT UPDATE (reference_photo_attributions) ON TABLE public.orders TO authenticated';
  END IF;
END $$;

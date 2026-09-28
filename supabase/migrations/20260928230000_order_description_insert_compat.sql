-- Production retains NOT NULL orders.description; current clients/Edge write
-- garment_description. Dev lacked the legacy column, hiding the failure.
-- Add its nullable compatibility shape in Dev without backfilling rows, and
-- mirror only a missing description at INSERT time. Preserve both provided
-- values, existing rows, update behavior, trust gates and RLS.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS description text;

CREATE OR REPLACE FUNCTION public.fill_order_insert_description_compat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF nullif(btrim(NEW.description), '') IS NULL
     AND nullif(btrim(NEW.garment_description), '') IS NOT NULL THEN
    NEW.description := NEW.garment_description;
  ELSIF nullif(btrim(NEW.garment_description), '') IS NULL
     AND nullif(btrim(NEW.description), '') IS NOT NULL THEN
    NEW.garment_description := NEW.description;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER orders_fill_insert_description_compat
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.fill_order_insert_description_compat();

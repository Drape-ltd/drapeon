-- Clients, Edge, shared contracts and fabric guards use CUSTOMER_SUPPLIES.
-- The original database enum used CUSTOMER_SUPPLIED. Rename the same enum
-- identity, preserving existing rows and constraints without a data backfill.
-- Dev is already canonical; production is not. Fail closed on ambiguous drift.
DO $repair$
DECLARE canonical boolean; legacy boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.fabric_source'::regtype AND enumlabel='CUSTOMER_SUPPLIES'),
         EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.fabric_source'::regtype AND enumlabel='CUSTOMER_SUPPLIED')
    INTO canonical, legacy;
  IF canonical AND legacy THEN
    RAISE EXCEPTION 'Ambiguous fabric_source enum: review before promotion';
  ELSIF legacy THEN
    ALTER TYPE public.fabric_source RENAME VALUE 'CUSTOMER_SUPPLIED' TO 'CUSTOMER_SUPPLIES';
  ELSIF NOT canonical THEN
    RAISE EXCEPTION 'Expected customer fabric_source value is missing';
  END IF;
END;
$repair$;

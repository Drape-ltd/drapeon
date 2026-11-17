-- `seller_items` embeds its tailor profile in the public catalogue response.
-- RLS already limits the rows and columns a caller can see, but the table had
-- no SELECT privilege for the API roles. Granting table access is therefore
-- necessary for the existing RLS policies to take effect; it does not make
-- private or unverified profiles readable.
grant select on table public.tailor_profiles to anon, authenticated;

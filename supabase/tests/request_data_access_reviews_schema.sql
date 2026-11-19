-- Read-only schema proof for the reviews projection in request-data-access.
-- Run against Dev and Production before promoting the function.
select id, order_id, rating, body, tags, reviewer_name,
  tailor_response, published_at, created_at
from public.reviews limit 0;

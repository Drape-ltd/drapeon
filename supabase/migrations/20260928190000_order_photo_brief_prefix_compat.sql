-- Keep customer brief uploads working across mobile build generations.
--
-- The current mobile build used `briefs/<user_id>/...`, while the original
-- Storage policy documented and enforced `brief/<user_id>/...`. Accept both
-- prefixes during the rollout; the next mobile build writes the canonical
-- singular `brief/` prefix. This is intentionally additive and does not widen
-- access beyond the authenticated owner of the path.

DROP POLICY IF EXISTS "order-photos: parties can upload" ON storage.objects;
CREATE POLICY "order-photos: parties can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-photos'
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov'])
    AND (
      (
        split_part(name, '/', 1) IN ('brief', 'briefs')
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      OR
      (
        split_part(name, '/', 1) = 'progress'
        AND EXISTS (
          SELECT 1 FROM orders o
          JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
          WHERE o.id::text = split_part(name, '/', 2)
            AND tp.user_id::text = auth.uid()::text
        )
      )
    )
  );

DROP POLICY IF EXISTS "order-photos: parties can read" ON storage.objects;
CREATE POLICY "order-photos: parties can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-photos'
    AND (
      (
        split_part(name, '/', 1) IN ('brief', 'briefs')
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      OR
      (
        split_part(name, '/', 1) = 'progress'
        AND EXISTS (
          SELECT 1 FROM orders o
          LEFT JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
          WHERE o.id::text = split_part(name, '/', 2)
            AND (
              o.customer_id::text = auth.uid()::text
              OR tp.user_id::text = auth.uid()::text
            )
        )
      )
    )
  );

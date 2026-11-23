# Private order-media remediation

## Security finding

`storage.buckets.order-photos` is public in Production. The bucket contains
customer brief and order-progress media. The existing `storage.objects` RLS
policies correctly describe the intended customer/tailor access boundary, but
Supabase public-bucket downloads bypass those policies. A public object URL is
therefore not an acceptable access control for this bucket.

This is a security release, not a cosmetic URL cleanup. Do not apply the bucket
change separately from the reader and writer release described below.

## Preserved behaviour

- The customer who owns a brief and the assigned tailor can upload and read the
  same media they can today.
- Existing order references continue to render for their authorised parties.
- Ops and server-side notification/evidence flows retain service-role access.
- Public portfolio, avatar, ready-made and seller-item media remain outside
  this change.

## Current contract and compatibility inputs

`order-photos` references currently occur in several forms:

1. legacy public object URLs;
2. signed object URLs issued by prior readers;
3. bare object paths; and
4. new browser/mobile writers that call `getPublicUrl` after upload.

The bucket's path policies accept customer brief prefixes (`brief/` and
`briefs/`) and assigned-tailor progress prefixes (`progress/<order-id>/`). The
historical brief policy does **not** let an assigned tailor read the customer's
brief object; the public bucket has masked that defect. The forward policy
bridge in `20261123190000_order_photo_private_party_read.sql` adds exact
reference-path access for only the assigned tailor. These policies must remain
in force when `public` changes to `false`.

## Required release units

### 1. Shared normalisation and moderation (additive)

- Add a single order-media path normaliser that accepts only a bare
  `order-photos` path, a legacy public object URL, or a signed object URL from
  this Supabase project. It must reject external URLs and paths for other
  buckets.
- Change `queueMediaSafetyReview` callers for order media to supply a bucket
  and path. `media_assets` must record `order-photos` plus the object path;
  it must not require a public delivery URL.
- Preserve the public-media path for portfolio, avatar, ready-made and seller
  item surfaces. Do not make `parsePublicStorageUrl` silently classify a bare
  order-media path as `external-public`.

### 2. Writers (additive compatibility)

Change every order-media writer to persist a bare path, not
`getPublicUrl(path)`:

- web brief form and order customer/tailor action helpers;
- mobile customer brief, customer/tailor order, Drapeon Vision and Studio
  upload flows;
- `studio-order-action`, `tailor-order-action` and any Edge workflow that
  currently stores a generated public object URL.

Writers may continue to upload directly under the current Storage RLS policies.
They must not emit a public URL after the bucket is private.

### 3. Readers and presentation

For every authenticated customer/tailor reader, normalise the stored value to a
path and mint a short-lived signed URL using that caller's Supabase session.
This includes web order/brief/Studio views and mobile order/brief/Studio views,
including image, video and lightbox presentation. The user client must not
receive a service-role credential.

Server readers that compose mail, Ops evidence, or jobs must normalise the same
legacy values and use their already-authorised service client to create signed
URLs. The existing `_shared/order-email.ts` normaliser is a reference but must
be made the single shared contract rather than duplicated.

### 4. Bucket switch (separate, forward-only migration)

Only after units 1–3 are deployed and verified in Dev, apply one exact migration
that changes `storage.buckets.public` to `false` for `order-photos`. Do not
alter Storage policies in the same migration unless a policy test identifies a
specific defect. The release must include a forward recovery procedure (restore
private-reader compatibility), not a broad rollback or a public-bucket toggle.

## Tests and proof required before Production approval

1. Unit tests for normalising bare paths, legacy public URLs and signed URLs;
   external URLs and other buckets are rejected.
2. A contract test that fails when an order-media writer calls `getPublicUrl`.
3. Dev Storage proof: anonymous list/download is denied after the bucket switch;
   the brief owner and assigned tailor can obtain/use a signed URL; an unrelated
   signed-in account cannot.
4. Media-safety proof: a new private order upload creates the same media asset
   and review record as before, with bucket/path metadata and no public URL.
5. Web and mobile (iOS and Android) proof for customer brief/order and tailor
   order/Studio media, including legacy Production-shaped public URL values.
6. Ops and email evidence proof, with IDs only and no signed URL in logs or
   evidence.

## Production release order

1. Reviewed code/Edge release containing units 1–3, with the bucket still
   public for backwards compatibility.
2. Dev functional and privacy proof, then a reviewed exact Production Edge/web
   release.
3. Separate explicit approval for the one bucket-private migration.
4. Postflight: anonymous download returns a denial; authorised parties load the
   same media; Storage, queue and media-safety errors remain stable.

No existing public URL needs to be rewritten in the database. Readers normalise
legacy URLs during the compatibility window. Do not remove that support until a
measured backfill and all supported client builds have aged out.

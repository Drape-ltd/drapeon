# Explore sections: read-only Production preflight for agent 1

This is a query plan, not approval to access Production. Agent 1 must first
obtain the founder's approval for this specific read-only preflight and confirm
the selected project is Drape-PROD outside SQL. Stop if any result differs from
the expected values below. Do not apply the migration as a way to discover a
missing prerequisite.

```sql
-- Expected: true. A1 must already have created the decision-history table.
select to_regclass('public.marketplace_category_decisions') is not null
  as marketplace_category_decisions_exists;

-- Expected: one READY_TO_WEAR row in public.marketplace_category.
select n.nspname as schema_name, t.typname as enum_name, e.enumlabel
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname = 'marketplace_category'
  and e.enumlabel = 'READY_TO_WEAR';

-- Expected: exactly this non-null 13-argument regprocedure.
select to_regprocedure(
  'public.enqueue_domain_event(text,text,text,jsonb,text,uuid,text,uuid,jsonb,text[],integer,integer,timestamptz)'
) as enqueue_domain_event_signature;

-- Expected: matching text/text or uuid/uuid. This migration accepts only those shapes.
select a.attrelid::regclass as relation_name, a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as column_type
from pg_attribute a
where (a.attrelid = 'public.tailor_profiles'::regclass and a.attname = 'id')
   or (a.attrelid = 'public.marketplace_category_decisions'::regclass
       and a.attname = 'tailor_profile_id')
order by relation_name::text;
```

## Required release order

1. Merge only after review. Deploy `process-job-queue`, `ops-read-gateway`, and
   `handle-verification-decision` from the reviewed SHA. Verify each deployed
   version and a healthy existing queue/approval read path. The queue worker
   must recognize `explore_section_moved` before the database can enqueue it.
2. Obtain separate approval for this catalog-only preflight, run the queries
   above, and review the exact pending version `20261118231408`.
3. Obtain separate apply approval. Apply only that version and verify its
   history row, function/trigger definitions, ACLs, queue health, and a bounded
   Dev-proven synthetic section move with its recorded push, inbox and email
   outcomes.
4. Release web, mobile, and Ops separately after the database is verified.

Never apply the migration on its own. No Production query or deployment was
performed while preparing this plan.

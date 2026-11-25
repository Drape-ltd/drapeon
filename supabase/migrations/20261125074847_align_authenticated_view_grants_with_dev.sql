-- Follow-up to #336: these four Production objects are views (relkind v).
-- Revoke only the non-Data-API atoms absent in Dev; CRUD grants are unchanged.

revoke maintain, references, trigger, truncate
on table public.commercial_benefit_reporting
from authenticated;

revoke maintain, references, trigger, truncate
on table public.commercial_delivery_outcome_reporting
from authenticated;

revoke maintain, references, trigger, truncate
on table public.commercial_tip_reporting
from authenticated;

revoke maintain, references, trigger, truncate
on table public.drape_vision_ground_truth_comparison
from authenticated;

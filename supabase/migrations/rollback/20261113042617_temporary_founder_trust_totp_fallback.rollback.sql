-- Emergency rollback: preserve the audit trail and nullable Auth binding, but
-- make every temporary founder TOTP proof fail closed immediately.
update public.ops_founder_trust_mfa_fallback
set enabled = false,
    updated_at = now()
where singleton = true;

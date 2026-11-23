-- Export packages are released through the audited Edge route only.
revoke select on public.tailor_data_exports from authenticated;

-- Forward-only repair. The grants above reassert the known existing baseline;
-- do not revoke columns or restore any table-wide SELECT privilege.
do $$ begin end $$;

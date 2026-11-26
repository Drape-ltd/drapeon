-- Forward-only money repair; never drop the reviewed recovery function in rollback.
DO $$ BEGIN RAISE EXCEPTION 'S4_REFUND_RECOVERY_FORWARD_ONLY'; END $$;

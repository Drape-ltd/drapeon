import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Ensures a confirmed initial-order collection has its immutable staged plan.
 * This is deliberately idempotent: refresh_order_settlement creates the plan
 * once and only refreshes derived eligibility on replay.
 */
export async function refreshBachsInitialOrderSettlement(
  supabase: SupabaseClient,
  input: { orderId: string; phase: string },
) {
  if (input.phase !== "INITIAL_ORDER") return { refreshed: false as const };
  const { data, error } = await supabase.rpc("refresh_order_settlement", {
    p_order_id: input.orderId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Bachs initial-order settlement refresh returned no plan outcome.",
    );
  }
  return { refreshed: true as const, outcome: data };
}

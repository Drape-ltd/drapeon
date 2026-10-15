import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function digestEnvironment(value: string) {
  switch (value.trim().toUpperCase()) {
    case "DEV":
    case "DEVELOPMENT":
      return "DEVELOPMENT";
    case "PROD":
    case "PRODUCTION":
      return "PRODUCTION";
    default:
      throw new Error("Cannot build Ops digest for an unknown environment");
  }
}

export async function readOpsSlackDigest(supabase: SupabaseClient, environment: string) {
  const scope = digestEnvironment(environment);
  const activeQuery = (head: boolean) => supabase.from("ops_issues")
    .select("issue_number,case_number,title,created_at", { count: "exact", head })
    .eq("environment", scope)
    .not("canonical_status", "in", "(RESOLVED,CLOSED,CANCELLED)");
  // Count the entire filtered backlog, transferring only its oldest summary.
  // Separate reads are a digest snapshot, not an atomic financial ledger.
  const [all, critical, high] = await Promise.all([
    activeQuery(false).order("created_at", { ascending: true })
      .order("id", { ascending: true }).limit(1),
    activeQuery(true).eq("severity", "CRITICAL"),
    activeQuery(true).eq("severity", "HIGH"),
  ]);
  for (const result of [all, critical, high]) {
    if (result.error || !Number.isSafeInteger(result.count) || result.count! < 0) {
      throw new Error("Could not read complete Ops digest counts");
    }
  }
  return {
    active: all.count!, critical: critical.count!, high: high.count!,
    oldest: all.data?.[0] ?? null,
  };
}

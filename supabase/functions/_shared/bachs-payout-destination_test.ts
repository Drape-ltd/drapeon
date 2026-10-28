import { assertEquals } from "jsr:@std/assert@1";
import type { BachsAccount } from "./bachs-operations.ts";
import { syncBachsPayoutDestination } from "./bachs-payout-destination.ts";

const account: BachsAccount = {
  id: "acct_bachs_qa",
  country: "NG",
  responsibilities: { fees: { collector: "platform" } },
  capabilities: {
    transfers: { status: "active" },
    payouts: { status: "active" },
  },
};

function fakeSupabase(options: {
  route?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  routeError?: { code?: string; message?: string } | null;
} = {}) {
  const writes: Array<{ operation: string; value: Record<string, unknown> }> =
    [];
  let table = "";
  let operation = "select";
  let value: Record<string, unknown> = {};
  const supabase = {
    from(name: string) {
      table = name;
      operation = "select";
      value = {};
      const query: any = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          const defaultRoute = {
            id: "route-bachs-ngn",
            version: 1,
            provider: "BACHS",
            legal_entity: "DRAPE_MARKETPLACE_LIMITED",
            tailor_country_code: "NG",
            payout_currency: "NGN",
            fees_collector: "PLATFORM",
          };
          return Promise.resolve({
            data: table === "payment_routes"
              ? (Object.prototype.hasOwnProperty.call(options, "route")
                ? options.route
                : defaultRoute)
              : (options.existing ?? null),
            error: null,
          });
        },
        insert(row: Record<string, unknown>) {
          operation = "insert";
          value = row;
          return query;
        },
        update(row: Record<string, unknown>) {
          operation = "update";
          value = row;
          return query;
        },
        single() {
          writes.push({ operation, value });
          return Promise.resolve({
            data: { id: "destination-new" },
            error: null,
          });
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          const result = table === "payment_routes"
            ? { data: options.route ?? null, error: options.routeError ?? null }
            : { data: null, error: null };
          if (operation === "update") writes.push({ operation, value });
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { supabase, writes };
}

Deno.test("Bachs destination is stored against the route fee policy and starts review-pending", async () => {
  const { supabase, writes } = fakeSupabase();
  const result = await syncBachsPayoutDestination(supabase, {
    tailorProfileId: "profile-qa",
    routeId: "route-bachs-ngn",
    routeVersion: 1,
    account,
    checkedAt: "2026-10-27T12:00:00Z",
  });
  assertEquals(result, {
    persisted: true,
    destinationId: "destination-new",
    active: false,
  });
  assertEquals(writes[0].value, {
    tailor_profile_id: "profile-qa",
    provider: "BACHS",
    legal_entity: "DRAPE_MARKETPLACE_LIMITED",
    country_code: "NG",
    currency: "NGN",
    provider_account_ref: "acct_bachs_qa",
    fees_collector: "PLATFORM",
    transfers_enabled: true,
    payouts_enabled: true,
    first_withdrawal_review_status: "PENDING",
    active: false,
    capability_checked_at: "2026-10-27T12:00:00Z",
  });
});

Deno.test("Bachs refresh preserves first-withdrawal review and immutable destination identity", async () => {
  const { supabase, writes } = fakeSupabase({
    existing: {
      id: "destination-existing",
      tailor_profile_id: "profile-qa",
      legal_entity: "DRAPE_MARKETPLACE_LIMITED",
      country_code: "NG",
      currency: "NGN",
      fees_collector: "PLATFORM",
      first_withdrawal_review_status: "PENDING",
    },
  });
  const result = await syncBachsPayoutDestination(supabase, {
    tailorProfileId: "profile-qa",
    routeId: "route-bachs-ngn",
    routeVersion: 1,
    account,
    checkedAt: "2026-10-27T12:00:00Z",
  });
  assertEquals(result, {
    persisted: true,
    destinationId: "destination-existing",
    active: false,
  });
  assertEquals(writes[0].operation, "update");
  assertEquals(writes[0].value, {
    transfers_enabled: true,
    payouts_enabled: true,
    active: false,
    capability_checked_at: "2026-10-27T12:00:00Z",
  });
});

Deno.test("Bachs destination activates only after both capabilities and first-withdrawal review", async () => {
  const { supabase, writes } = fakeSupabase({
    existing: {
      id: "destination-existing",
      tailor_profile_id: "profile-qa",
      legal_entity: "DRAPE_MARKETPLACE_LIMITED",
      country_code: "NG",
      currency: "NGN",
      fees_collector: "PLATFORM",
      first_withdrawal_review_status: "CLEARED",
    },
  });
  const result = await syncBachsPayoutDestination(supabase, {
    tailorProfileId: "profile-qa",
    routeId: "route-bachs-ngn",
    routeVersion: 1,
    account,
    checkedAt: "2026-10-27T12:00:00Z",
  });
  assertEquals(result, {
    persisted: true,
    destinationId: "destination-existing",
    active: true,
  });
  assertEquals(writes[0].value.active, true);
});

Deno.test("Bachs lost capability immediately deactivates a previously usable destination", async () => {
  const { supabase, writes } = fakeSupabase({
    existing: {
      id: "destination-existing",
      tailor_profile_id: "profile-qa",
      legal_entity: "DRAPE_MARKETPLACE_LIMITED",
      country_code: "NG",
      currency: "NGN",
      fees_collector: "PLATFORM",
      first_withdrawal_review_status: "CLEARED",
    },
  });
  const result = await syncBachsPayoutDestination(supabase, {
    tailorProfileId: "profile-qa",
    routeId: "route-bachs-ngn",
    routeVersion: 1,
    account: {
      ...account,
      capabilities: {
        transfers: { status: "active" },
        payouts: { status: "restricted" },
      },
    },
    checkedAt: "2026-10-27T12:00:00Z",
  });
  assertEquals(result, {
    persisted: true,
    destinationId: "destination-existing",
    active: false,
  });
  assertEquals(writes[0].value.payouts_enabled, false);
});

Deno.test("Bachs destination fails closed without one route fee policy", async () => {
  const none = fakeSupabase({ route: null });
  assertEquals(
    await syncBachsPayoutDestination(none.supabase, {
      tailorProfileId: "profile-qa",
      routeId: "route-bachs-ngn",
      routeVersion: 1,
      account,
      checkedAt: "2026-10-27T12:00:00Z",
    }),
    { persisted: false, reason: "NO_ROUTE_FEE_POLICY" },
  );

  const conflict = fakeSupabase({
    route: {
      id: "route-bachs-ngn",
      version: 1,
      provider: "BACHS",
      legal_entity: "DRAPE_MARKETPLACE_LIMITED",
      tailor_country_code: "GH",
      payout_currency: "NGN",
      fees_collector: "PLATFORM",
    },
  });
  let rejected = false;
  try {
    await syncBachsPayoutDestination(conflict.supabase, {
      tailorProfileId: "profile-qa",
      routeId: "route-bachs-ngn",
      routeVersion: 1,
      account,
      checkedAt: "2026-10-27T12:00:00Z",
    });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message === "BACHS_DESTINATION_ROUTE_IDENTITY_CONFLICT";
  }
  if (!rejected) {
    throw new Error(
      "The provider country must equal the exact snapshotted route country.",
    );
  }

  let collectorRejected = false;
  try {
    const wrongCollectorRoute = fakeSupabase({
      route: {
        id: "route-bachs-ngn",
        version: 1,
        provider: "BACHS",
        legal_entity: "DRAPE_MARKETPLACE_LIMITED",
        tailor_country_code: "NG",
        payout_currency: "NGN",
        fees_collector: "CONNECTED_ACCOUNT",
      },
    });
    await syncBachsPayoutDestination(wrongCollectorRoute.supabase, {
      tailorProfileId: "profile-qa",
      routeId: "route-bachs-ngn",
      routeVersion: 1,
      account,
      checkedAt: "2026-10-27T12:00:00Z",
    });
  } catch (error) {
    collectorRejected = error instanceof Error &&
      error.message === "BACHS_DESTINATION_FEE_COLLECTOR_CONFLICT";
  }
  if (!collectorRejected) {
    throw new Error("A provider account's immutable fee collector must match the route.");
  }
});

Deno.test("Bachs identity conflict is rejected instead of moving an account between tailors", async () => {
  const { supabase } = fakeSupabase({
    existing: {
      id: "destination-existing",
      tailor_profile_id: "other-profile",
      legal_entity: "DRAPE_MARKETPLACE_LIMITED",
      country_code: "NG",
      currency: "NGN",
      fees_collector: "PLATFORM",
      first_withdrawal_review_status: "PENDING",
    },
  });
  let rejected = false;
  try {
    await syncBachsPayoutDestination(supabase, {
      tailorProfileId: "profile-qa",
      routeId: "route-bachs-ngn",
      routeVersion: 1,
      account,
      checkedAt: "2026-10-27T12:00:00Z",
    });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message === "BACHS_DESTINATION_IDENTITY_CONFLICT";
  }
  if (!rejected) {
    throw new Error(
      "A provider account already bound to another tailor must be rejected.",
    );
  }
});

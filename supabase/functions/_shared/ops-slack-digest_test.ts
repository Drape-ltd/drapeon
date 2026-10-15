import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { digestEnvironment, readOpsSlackDigest } from "./ops-slack-digest.ts";

Deno.test("digest accepts known environment aliases only", () => {
  assertEquals(digestEnvironment("dev"), "DEVELOPMENT");
  assertEquals(digestEnvironment("PRODUCTION"), "PRODUCTION");
  assertThrows(() => digestEnvironment("UNKNOWN"));
});

Deno.test("digest uses full counts beyond 100 and scopes every query", async () => {
  const requests: Request[] = [];
  const oldest = { issue_number: 1, case_number: "OPS-1234", title: "Oldest", created_at: "2020-01-01" };
  const client = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const severity = new URL(request.url).searchParams.get("severity");
      const count = severity === "eq.CRITICAL" ? 120 : severity === "eq.HIGH" ? 130 : 310;
      return Promise.resolve(new Response(request.method === "HEAD" ? null : JSON.stringify([oldest]), {
        status: 200, headers: { "content-type": "application/json", "content-range": `0-0/${count}` },
      }));
    } },
  });
  assertEquals(await readOpsSlackDigest(client, "DEV"), { active: 310, critical: 120, high: 130, oldest });
  assertEquals(requests.length, 3);
  for (const request of requests) {
    const params = new URL(request.url).searchParams;
    assertEquals(params.get("environment"), "eq.DEVELOPMENT");
    assertEquals(params.get("canonical_status"), "not.in.(RESOLVED,CLOSED,CANCELLED)");
    assertEquals(request.headers.get("prefer"), "count=exact");
    if (request.method === "GET") {
      assertEquals(params.get("limit"), "1");
      assertEquals(params.get("order"), "created_at.asc,id.asc");
    }
  }
  assertEquals(requests.filter((request) => request.method === "HEAD").length, 2);
});

Deno.test("digest never reports zero when a count is missing or query fails", async () => {
  for (const status of [200, 500]) {
    const client = createClient("https://example.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: () => Promise.resolve(new Response("[]", { status, headers: { "content-type": "application/json" } })) },
    });
    await assertRejects(() => readOpsSlackDigest(client, "PROD"), Error, "complete Ops digest counts");
  }
});

Deno.test("digest permits a confirmed empty production backlog", async () => {
  const client = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const request = new Request(input, init);
      assertEquals(new URL(request.url).searchParams.get("environment"), "eq.PRODUCTION");
      return Promise.resolve(new Response(request.method === "HEAD" ? null : "[]", {
        headers: { "content-type": "application/json", "content-range": "*/0" },
      }));
    } },
  });
  assertEquals(await readOpsSlackDigest(client, "PROD"), { active: 0, critical: 0, high: 0, oldest: null });
});

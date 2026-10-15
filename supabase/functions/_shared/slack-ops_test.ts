import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  exactOpsIssueUrl,
  activeOpsQueueUrl,
  opsCaseLabel,
  redactSlackText,
  routedChannelKeys,
} from "./slack-ops.ts";

Deno.test("Slack Ops links open the exact authenticated case", () => {
  const url = exactOpsIssueUrl("ops-a7107c46", "https://ops.drapeon.co/");
  assertEquals(url, "https://ops.drapeon.co/ops/cases/OPS-A7107C46");
});

Deno.test("Slack uses the same case identifier as Ops and labels legacy numbers explicitly", () => {
  assertEquals(opsCaseLabel({ case_number: "ops-a7107c46", issue_number: 42 }), "OPS-A7107C46");
  assertEquals(opsCaseLabel({ issue_number: 42 }), "Legacy #0042");
  assertEquals(opsCaseLabel({ case_number: "<unsafe>", issue_number: 42 }), "Legacy #0042");
  assertEquals(activeOpsQueueUrl("https://ops.drapeon.co/"), "https://ops.drapeon.co/ops/queues/all");
});

Deno.test("Slack summaries redact contact data, URLs, and common secrets", () => {
  const safe = redactSlackText(
    "email person@example.com phone +1 (615) 964-2153 url https://private.example/proof " +
      "api_key=sk_test_1234567890abcdefghijkl xoxb-1234567890-abcdefghijkl password=hunter2",
  );
  assertFalse(safe.includes("person@example.com"));
  assertFalse(safe.includes("615"));
  assertFalse(safe.includes("private.example"));
  assertFalse(safe.includes("sk_test"));
  assertFalse(safe.includes("xoxb-"));
  assertFalse(safe.includes("hunter2"));
  assertStringIncludes(safe, "[email hidden]");
  assertStringIncludes(safe, "[secure link hidden]");
});

Deno.test("critical money cases route to specialist and critical channels", () => {
  const channels = routedChannelKeys({
    issue_type: "PAYOUT_FAILED",
    severity: "CRITICAL",
    source: "release-order-payouts",
    stage: null,
    title: "Provider transfer failed",
  });
  assert(channels.includes("OPS_MONEY"));
  assert(channels.includes("OPS_CRITICAL"));
  assertEquals(channels.length, 2);
});

Deno.test("routine system alerts stay in engineering rather than Ops intake", () => {
  const channels = routedChannelKeys({
    issue_type: "SYSTEM_ALERT",
    severity: "HIGH",
    source: "sentry-ops-webhook",
    stage: null,
    title: "Runtime failure",
  });
  assertEquals(channels, ["ENGINEERING_ERRORS"]);
});

Deno.test("technical payment failures do not become money cases through keyword routing", () => {
  const issue = { issue_type: "SYSTEM_ALERT", severity: "HIGH", source: "process-job-queue", stage: "RECONCILE_PAYMENT_WEBHOOK", title: "Job failed" };
  assertEquals(routedChannelKeys(issue), ["ENGINEERING_ERRORS"]);
  assertEquals(routedChannelKeys({ ...issue, severity: "CRITICAL" }), ["ENGINEERING_ERRORS", "OPS_CRITICAL"]);
  assertEquals(routedChannelKeys(issue, { action_taken: "ISSUE_ESCALATED", after_state: { backupTeam: "admin" } }), ["ENGINEERING_ERRORS", "OPS_CRITICAL"]);
  assertEquals(routedChannelKeys(issue, { action_taken: "ISSUE_ESCALATED", after_state: { backupTeam: "unrecognized-channel" } }), ["ENGINEERING_ERRORS"]);
});

import {
  bachsTransferIssueKeys,
  planBachsTransferWatchdogIssue,
} from "../functions/_shared/bachs-transfer-watchdog.ts";

const container = Deno.env.get("BACHS_MONITOR_TEST_CONTAINER");
if (!container) throw new Error("Missing disposable Postgres container");
async function sql(query: string): Promise<string> {
  const result = await new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = result.stdin.getWriter();
  await writer.write(new TextEncoder().encode(query));
  await writer.close();
  const output = await result.output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}
const claimId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const keys = bachsTransferIssueKeys("BACHS", sourceId);
async function scan() {
  const [status, createdAt] = (await sql(
    `select status, operation_created_at from payout_claims where id = '${claimId}';`,
  )).split("|");
  if (status === "PROVIDER_PENDING") {
    const existing = await sql(
      `select status from ops_issues where dedupe_key = '${keys.overdue}';`,
    );
    const plan = planBachsTransferWatchdogIssue({
      provider: "BACHS",
      sourceId,
      operationCreatedAt: createdAt,
      existingIssue: existing ? { status: existing } : null,
    });
    if (plan.assessment.reason !== "PENDING_OVERDUE") {
      throw new Error("Expected aged pending transfer");
    }
    if (plan.notifyOps) {
      await sql(
        `with issue as (insert into ops_issues(dedupe_key,status) values ('${plan.activeKey}','OPEN') on conflict (dedupe_key) do update set status = 'OPEN' returning id) insert into ops_audit_logs(issue_id,action) select id,'ISSUE_CREATED' from issue;`,
      );
    }
  } else if (status === "TRANSFERRED") {
    await sql(
      `with resolved as (update ops_issues set status = 'RESOLVED' where dedupe_key = '${keys.overdue}' and status = 'OPEN' returning id) insert into ops_audit_logs(issue_id,action) select id,'ISSUE_AUTO_RESOLVED' from resolved;`,
    );
  }
}
await scan();
await scan();
const alertCounts = await sql(
  "select (select count(*) from ops_issues), (select count(*) from ops_messages where kind='ISSUE_CREATED');",
);
if (alertCounts !== "1|1") {
  throw new Error(`Expected one issue and one alert, got ${alertCounts}`);
}
await sql(
  `update payout_claims set status='TRANSFERRED' where id='${claimId}';`,
);
await scan();
await scan();
const recoveryCounts = await sql(
  "select (select count(*) from ops_issues where status='RESOLVED'), (select count(*) from ops_messages where kind='ISSUE_AUTO_RESOLVED');",
);
if (recoveryCounts !== "1|1") {
  throw new Error(
    `Expected one resolved issue and one recovery message, got ${recoveryCounts}`,
  );
}
console.log(
  "PASS: two aged scans produced one issue and alert; settlement produced one recovery message.",
);

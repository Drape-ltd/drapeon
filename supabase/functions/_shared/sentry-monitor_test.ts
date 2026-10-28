import { assertEquals, assertMatch } from "jsr:@std/assert";
import {
  normalizeSentryIssue,
  resolveSentryReporter,
  sanitizeSentryReporterName,
  sanitizeSentryText,
  shouldNotifySentryIssue,
} from "./sentry-monitor.ts";

Deno.test("sanitizeSentryText removes contact, link, and credential values", () => {
  const value = sanitizeSentryText(
    "Failed for person@example.com +1 615 555 0199 https://example.com sk_test_secretsecretsecret",
  );
  assertMatch(value, /\[email hidden\]/u);
  assertMatch(value, /\[phone hidden\]/u);
  assertMatch(value, /\[link hidden\]/u);
  assertMatch(value, /\[credential hidden\]/u);
});

Deno.test("sanitizeSentryReporterName keeps a usable name without contact data", () => {
  assertEquals(
    sanitizeSentryReporterName("Ada Stitch <ada@example.com>"),
    "Ada Stitch",
  );
  assertEquals(sanitizeSentryReporterName("+1 615 555 0199"), null);
});

Deno.test("resolveSentryReporter uses the current profile when Sentry only has an ID", async () => {
  const reporter = await resolveSentryReporter({
    id: "43f1d1a1-4e44-4b1c-8b50-71aac49992e3",
    role: "TAILOR",
  }, async (role, userId) => {
    assertEquals(role, "TAILOR");
    assertEquals(userId, "43f1d1a1-4e44-4b1c-8b50-71aac49992e3");
    return "Ada Stitch";
  });
  assertEquals(reporter, { name: "Ada Stitch", role: "tailor" });
});

Deno.test("normalizeSentryIssue creates a safe stable identity", () => {
  assertEquals(
    normalizeSentryIssue({
      id: "1234",
      shortId: "MOBILE-12",
      project: { slug: "drape-mobile" },
      level: "fatal",
      title: "Crash in checkout",
      count: "7",
    }),
    {
      issueId: "1234",
      shortId: "MOBILE-12",
      projectSlug: "drape-mobile",
      level: "fatal",
      title: "Crash in checkout",
      count: 7,
      severity: "CRITICAL",
      dedupeKey: "sentry:drape-mobile:1234",
      lastSeenAt: null,
    },
  );
});

Deno.test("shouldNotifySentryIssue suppresses count churn inside cooldown", () => {
  const issue = normalizeSentryIssue({
    id: "1234",
    project: { slug: "drape-mobile" },
    level: "error",
    title: "Crash",
    count: 8,
  })!;
  const now = new Date("2026-08-27T12:00:00.000Z");
  assertEquals(shouldNotifySentryIssue(issue, null, now), true);
  assertEquals(
    shouldNotifySentryIssue(issue, {
      last_count: 7,
      last_severity: "HIGH",
      last_notified_at: "2026-08-27T11:45:00.000Z",
    }, now),
    false,
  );
  assertEquals(
    shouldNotifySentryIssue(issue, {
      last_count: 7,
      last_severity: "HIGH",
      last_notified_at: "2026-08-27T11:00:00.000Z",
    }, now),
    true,
  );
});

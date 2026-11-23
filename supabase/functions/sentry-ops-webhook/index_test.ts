import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSentryOpsEvent } from "../_shared/sentry-ops-webhook.ts";

Deno.test("Sentry payload becomes a stable critical Ops event", () => {
  const parsed = parseSentryOpsEvent({
    data: {
      issue: {
        id: "123456789",
        shortId: "MOBILE-42",
        title: "Fatal checkout crash",
        level: "fatal",
        count: "7",
        project: { slug: "drape-mobile" },
      },
    },
  });
  assertEquals(parsed.severity, "CRITICAL");
  assertEquals(parsed.projectSlug, "drape-mobile");
  assertEquals(parsed.count, 7);
  assertEquals(parsed.dedupeKey, "sentry:drape-mobile:123456789");
});

Deno.test("Sentry titles do not carry external links into Ops or Slack", () => {
  const parsed = parseSentryOpsEvent({
    data: {
      issue: {
        id: "1",
        title: "Failure at https://private.example/event/secret",
        level: "error",
      },
    },
  });
  assertStringIncludes(parsed.title, "[link hidden]");
});

Deno.test("Sentry events identify customers and tailors without contact details", () => {
  const parsed = parseSentryOpsEvent({
    data: {
      event: { user: { role: "TAILOR", name: "Ada Stitch ada@example.com" } },
      issue: {
        id: "1",
        title: "Image load failed",
        project: { slug: "drape-mobile" },
      },
    },
  });
  assertEquals(parsed.reporter, { role: "tailor", name: "Ada Stitch" });
  const customer = parseSentryOpsEvent({
    data: { event: { user: { role: "CUSTOMER", name: "Customer One" } } },
  });
  assertEquals(customer.reporter, { role: "customer", name: "Customer One" });
});

Deno.test("resolved Sentry actions close the matching durable Ops case", () => {
  const parsed = parseSentryOpsEvent({
    action: "resolved",
    data: {
      issue: {
        id: "123456789",
        title: "Recovered checkout crash",
        project: { slug: "drape-mobile" },
      },
    },
  });
  assertEquals(parsed.isResolved, true);
  assertEquals(parsed.dedupeKey, "sentry:drape-mobile:123456789");
});

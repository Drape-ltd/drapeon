import { scannerBursts } from "./scanner-burst.ts";

const now = Date.parse("2026-11-26T07:00:00Z");
const events = Array.from({ length: 5 }, (_, i) => ({
  requestId: String(i),
  timeMs: now - i * 30_000,
  ip: "192.0.2.1",
  networkOrganization: "Fixture",
  userAgent: "Fixture",
  table: "orders",
}));

Deno.test("five distinct denials in two inclusive minutes produce one daily issue key", () => {
  const hits = scannerBursts(events, now, now - 600_000);
  if (hits.length !== 1 || hits[0].counts.orders !== 5 ||
    hits[0].dedupeKey !== "anon-scanner:192.0.2.1:2026-11-26") throw new Error("expected one burst");
});

Deno.test("duplicates, unrelated tables, other IPs and out-of-window requests cannot complete a burst", () => {
  const four = events.slice(0, 4);
  for (const event of [
    events[0],
    { ...events[4], table: "unrelated" },
    { ...events[4], ip: "192.0.2.2" },
    { ...events[4], timeMs: now - 120_001 },
  ]) {
    if (scannerBursts([...four, event], now, now - 600_000).length) throw new Error("unexpected burst");
  }
});

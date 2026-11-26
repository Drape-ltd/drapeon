const sensitive = new Set(["payouts", "payout_destinations", "payment_routes", "users", "orders", "order_payments"]);

export interface ScannerEvent {
  requestId: string;
  timeMs: number;
  ip: string;
  networkOrganization: string;
  userAgent: string;
  table: string;
}

export function scannerBursts(events: ScannerEvent[], now: number, since = now - 21_600_000) {
  const byIp = new Map<string, ScannerEvent[]>();
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.timeMs - b.timeMs)) {
    if (!event.ip || !event.requestId || !Number.isFinite(event.timeMs) ||
      event.timeMs < Math.max(since, now - 21_600_000) || event.timeMs > now ||
      seen.has(event.requestId) || !sensitive.has(event.table)) continue;
    seen.add(event.requestId);
    const group = byIp.get(event.ip) ?? [];
    group.push(event);
    byIp.set(event.ip, group);
  }

  return [...byIp.values()].flatMap((group) => {
    let start = 0;
    let best: ScannerEvent[] = [];
    for (let end = 0; end < group.length; end++) {
      while (group[end].timeMs - group[start].timeMs > 120_000) start++;
      if (end - start >= 4) best = group.slice(start, end + 1);
    }
    const latest = best.at(-1);
    if (!latest) return [];
    const counts: Record<string, number> = {};
    for (const { table } of best) counts[table] = (counts[table] ?? 0) + 1;
    return [{
      dedupeKey: `anon-scanner:${latest.ip}:${new Date(latest.timeMs).toISOString().slice(0, 10)}`,
      lastSeenMs: latest.timeMs,
      ip: latest.ip,
      networkOrganization: latest.networkOrganization,
      userAgent: latest.userAgent,
      counts,
    }];
  });
}

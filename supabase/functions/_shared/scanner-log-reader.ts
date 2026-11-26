import { scannerBursts, type ScannerEvent } from "./scanner-burst.ts";

const LIMIT = 2_000;
const WINDOW_MS = 21_600_000;

export const scannerLogQuery = `
select timestamp,
  log_attributes['request_id'] as request_id,
  log_attributes['request.headers.cf_connecting_ip'] as ip,
  left(log_attributes['request.cf.asOrganization'], 160) as network_org,
  left(log_attributes['request.headers.user_agent'], 160) as user_agent,
  extract(log_attributes['request.path'], '^/rest/v1/([a-z_]+)$') as relation
from logs
where source = 'edge_logs'
  and relation in ('payouts','payout_destinations','payment_routes','users','orders','order_payments')
  and notEmpty(ip) and notEmpty(request_id)
  and not startsWith(log_attributes['request.sb.apikey.apikey.prefix'], 'sb_secret_')
  and not startsWith(log_attributes['request.sb.apikey.authorization.prefix'], 'sb_secret_')
  and empty(log_attributes['request.sb.auth_user'])
  and (
    log_attributes['request.sb.jwt.authorization.payload.role'] = 'anon'
    or (
      empty(log_attributes['request.sb.jwt.authorization.payload.role'])
      and log_attributes['request.sb.jwt.apikey.payload.role'] = 'anon'
    )
  )
  and (
    log_attributes['response.status_code'] = '401'
    or position(log_attributes['response.headers.proxy_status'], '42501') > 0
  )
order by timestamp desc
limit ${LIMIT}
`;

export async function readScannerBursts(
  projectRef: string,
  token: string,
  now: number,
  fetchLogs: typeof fetch = fetch,
  since = now - WINDOW_MS,
) {
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !token.trim()) {
    throw new Error("SCANNER_LOG_READER_NOT_CONFIGURED");
  }
  const url = new URL(`https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs`);
  url.searchParams.set("sql", scannerLogQuery);
  url.searchParams.set("iso_timestamp_start", new Date(Math.max(since, now - WINDOW_MS)).toISOString());
  url.searchParams.set("iso_timestamp_end", new Date(now).toISOString());
  const response = await fetchLogs(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`SCANNER_LOG_HTTP_${response.status}`);
  const { result, error } = await response.json();
  if (error || !Array.isArray(result) || result.length > LIMIT) {
    throw new Error("SCANNER_LOG_RESULT_INVALID");
  }
  const events: ScannerEvent[] = result.flatMap((row) => {
    if (!row || typeof row.request_id !== "string" || typeof row.ip !== "string" ||
      typeof row.timestamp !== "string" || typeof row.relation !== "string") return [];
    const timestamp = row.timestamp.replace(" ", "T");
    return [{
      requestId: row.request_id,
      ip: row.ip,
      timeMs: Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) ? timestamp : timestamp + "Z"),
      table: row.relation,
      networkOrganization: typeof row.network_org === "string" ? row.network_org : "",
      userAgent: typeof row.user_agent === "string" ? row.user_agent : "",
    }];
  });
  return { bursts: scannerBursts(events, now, since), saturated: result.length === LIMIT };
}

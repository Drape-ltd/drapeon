export type SentryMonitorIssue = {
  issueId: string;
  shortId: string | null;
  projectSlug: string;
  level: string;
  title: string;
  count: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  dedupeKey: string;
  lastSeenAt: string | null;
};

export type SentryMonitorState = {
  last_count: number;
  last_severity: string;
  last_notified_at: string | null;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function opaqueId(value: unknown) {
  const candidate = text(value);
  return /^[a-zA-Z0-9._:-]{1,160}$/u.test(candidate) ? candidate : "";
}

export function sanitizeSentryText(value: unknown) {
  return text(value, "A monitored runtime issue needs review")
    .replace(/https?:\/\/\S+/giu, "[link hidden]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email hidden]")
    .replace(/\+?\d[\d\s().-]{7,}\d/gu, "[phone hidden]")
    .replace(
      /\b(?:sk|pk|sbp|eyJ)[-_a-zA-Z0-9.]{12,}\b/gu,
      "[credential hidden]",
    )
    .slice(0, 180);
}

export function sanitizeSentryReporterName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const name = sanitizeSentryText(value).replace(
    /\[(?:email|phone|link|credential) hidden\]/giu,
    "",
  )
    .replace(/[<>\[\]{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return name || null;
}

export async function resolveSentryReporter(
  value: unknown,
  lookupProfile: (
    role: "TAILOR" | "CUSTOMER",
    userId: string,
  ) => Promise<unknown>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const user = value as Record<string, unknown>;
  const role = text(user.role).toUpperCase();
  if (role !== "TAILOR" && role !== "CUSTOMER") return null;
  let name = sanitizeSentryReporterName(user.name);
  const userId = typeof user.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        .test(user.id)
    ? user.id
    : null;
  if (!name && userId) {
    try {
      name = sanitizeSentryReporterName(await lookupProfile(role, userId));
    } catch {
      return null;
    }
  }
  return name ? { name, role: role.toLowerCase() } : null;
}

export function severityForSentryLevel(level: string) {
  const normalized = level.trim().toLowerCase();
  if (normalized === "fatal") return "CRITICAL" as const;
  if (normalized === "error") return "HIGH" as const;
  if (normalized === "warning") return "MEDIUM" as const;
  return "LOW" as const;
}

export function normalizeSentryIssue(
  value: unknown,
): SentryMonitorIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issue = value as Record<string, unknown>;
  const project = issue.project && typeof issue.project === "object"
    ? issue.project as Record<string, unknown>
    : {};
  const issueId = opaqueId(issue.id);
  const projectSlug = opaqueId(project.slug) || opaqueId(issue.projectSlug);
  if (!issueId || !projectSlug) return null;
  const level = text(issue.level, "error").toLowerCase();
  const count = Number(issue.count ?? 1);
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;

  return {
    issueId,
    shortId: opaqueId(issue.shortId) || null,
    projectSlug,
    level,
    title: sanitizeSentryText(issue.title ?? issue.culprit),
    count: safeCount,
    severity: severityForSentryLevel(level),
    dedupeKey: `sentry:${projectSlug}:${issueId}`.slice(0, 500),
    lastSeenAt: text(issue.lastSeen) || null,
  };
}

const SEVERITY_RANK: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function shouldNotifySentryIssue(
  issue: SentryMonitorIssue,
  state: SentryMonitorState | null,
  now: Date,
  cooldownMs = 30 * 60 * 1000,
) {
  if (!state) return true;
  if (
    (SEVERITY_RANK[issue.severity] ?? 0) >
      (SEVERITY_RANK[state.last_severity] ?? 0)
  ) {
    return true;
  }
  if (issue.count <= state.last_count) return false;
  if (!state.last_notified_at) return true;
  const lastNotifiedAt = Date.parse(state.last_notified_at);
  return !Number.isFinite(lastNotifiedAt) ||
    now.getTime() - lastNotifiedAt >= cooldownMs;
}

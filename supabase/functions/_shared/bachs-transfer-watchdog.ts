export type BachsTransferWatchdogAssessment = {
  ageHours: number | null;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  notifyOps: boolean;
  reason:
    | "PENDING_WITHIN_SLA"
    | "PENDING_OVERDUE"
    | "PENDING_CRITICAL"
    | "OPERATION_AGE_MISSING";
};

export function shouldNotifyBachsTransferWatchdog(input: {
  assessment: BachsTransferWatchdogAssessment;
  existingIssue:
    | {
      status?: string | null;
      canonical_status?: string | null;
    }
    | null
    | undefined;
}): boolean {
  if (!input.assessment.notifyOps) return false;
  const status = input.existingIssue?.status?.toUpperCase();
  const canonicalStatus = input.existingIssue?.canonical_status?.toUpperCase();
  const terminal = status === "RESOLVED" || status === "CLOSED" ||
    canonicalStatus === "RESOLVED" || canonicalStatus === "CLOSED";
  return !input.existingIssue || terminal;
}

export function bachsTransferIssueKeys(
  provider: "BACHS" | "STRIPE",
  sourceId: string,
) {
  const prefix = `${provider.toLowerCase()}-tranche`;
  return {
    within: `${prefix}-pending:${sourceId}`,
    overdue: `${prefix}-overdue:${sourceId}`,
    critical: `${prefix}-critical:${sourceId}`,
    ageMissing: `${prefix}-age-missing:${sourceId}`,
  };
}

export function planBachsTransferWatchdogIssue(input: {
  provider: "BACHS" | "STRIPE";
  sourceId: string;
  operationCreatedAt: string | null | undefined;
  existingIssue:
    | { status?: string | null; canonical_status?: string | null }
    | null
    | undefined;
  nowMs?: number;
}) {
  const assessment = assessBachsTransferWatchdog({
    operationCreatedAt: input.operationCreatedAt,
    nowMs: input.nowMs,
  });
  const keys = bachsTransferIssueKeys(input.provider, input.sourceId);
  const activeKey = assessment.reason === "PENDING_CRITICAL"
    ? keys.critical
    : assessment.reason === "PENDING_OVERDUE"
    ? keys.overdue
    : assessment.reason === "OPERATION_AGE_MISSING"
    ? keys.ageMissing
    : keys.within;
  return {
    assessment,
    activeKey,
    priorKeys: Object.values(keys).filter((key) => key !== activeKey),
    notifyOps: shouldNotifyBachsTransferWatchdog({
      assessment,
      existingIssue: input.existingIssue,
    }),
  };
}

/**
 * Evaluate how long a Bachs transfer has remained unresolved.
 * Use the provider-operation creation time, not claim.updated_at, because the
 * reconciliation worker updates the claim every poll and must not reset age.
 */
export function assessBachsTransferWatchdog(input: {
  operationCreatedAt: string | null | undefined;
  nowMs?: number;
}): BachsTransferWatchdogAssessment {
  const parsed = input.operationCreatedAt
    ? Date.parse(input.operationCreatedAt)
    : NaN;
  if (!Number.isFinite(parsed) || parsed > (input.nowMs ?? Date.now())) {
    return {
      ageHours: null,
      severity: "HIGH",
      notifyOps: true,
      reason: "OPERATION_AGE_MISSING",
    };
  }

  const ageHours = Math.floor(
    ((input.nowMs ?? Date.now()) - parsed) / 3_600_000,
  );
  if (ageHours >= 72) {
    return {
      ageHours,
      severity: "CRITICAL",
      notifyOps: true,
      reason: "PENDING_CRITICAL",
    };
  }
  if (ageHours >= 24) {
    return {
      ageHours,
      severity: "HIGH",
      notifyOps: true,
      reason: "PENDING_OVERDUE",
    };
  }
  return {
    ageHours,
    severity: "MEDIUM",
    notifyOps: false,
    reason: "PENDING_WITHIN_SLA",
  };
}

export type DueSettlementPlan = {
  id: string
  order_id: string
  tailor_id: string
  customer_id: string
  currency: string
  status: string
}

export type EligibleSettlementTranche = {
  id: string
  code: string
  amount: number
  currency: string
  status: string
  eligible_at: string | null
}

export type EligibilityScanDependencies = {
  listDue(limit: number): Promise<DueSettlementPlan[]>
  markScanned(plan: DueSettlementPlan): Promise<void>
  refresh(plan: DueSettlementPlan): Promise<void>
  listEligible(plan: DueSettlementPlan): Promise<EligibleSettlementTranche[]>
  notify(plan: DueSettlementPlan, tranche: EligibleSettlementTranche): Promise<void>
  reportFailure(plan: DueSettlementPlan, error: unknown): void
}

// The scheduled lane has no payout, claim, transfer or provider callback.
export async function runSettlementEligibilityScan(
  deps: EligibilityScanDependencies,
): Promise<{ plansChecked: number; eligible: number; errors: number }> {
  const plans = await deps.listDue(100)
  let eligible = 0
  let errors = 0
  for (const plan of plans) {
    try {
      // Advance the bounded scan even if one plan cannot refresh. A missing Ops
      // case keeps it selectable on a later run.
      await deps.markScanned(plan)
      await deps.refresh(plan)
      const tranches = await deps.listEligible(plan)
      for (const tranche of tranches) {
        await deps.notify(plan, tranche)
        eligible += 1
      }
    } catch (error) {
      errors += 1
      deps.reportFailure(plan, error)
    }
  }
  return { plansChecked: plans.length, eligible, errors }
}

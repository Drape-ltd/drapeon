import {
  FABRIC_FUNDING_POLICY_VERSION,
  FABRIC_FUNDING_POLICY_V2_VERSION,
  LEGACY_FABRIC_FUNDING_POLICY_VERSION,
  isFundedFabricPolicy,
  resolveFabricQuoteAllocation,
} from '../src/fabric-funding'

describe.each([FABRIC_FUNDING_POLICY_VERSION, FABRIC_FUNDING_POLICY_V2_VERSION])(
  'quote compatibility: %s', (policyVersion) => {
    const base = { policyVersion, currency: 'ngn', subtotalAmount: 5_000_000 }
    const allocation = {
      tailoringAmount: 4_000_000, fabricAllowanceAmount: 1_000_000,
      coverage: ['FABRIC' as const], sourcingAssumptions: 'Six yards of agreed cotton.',
    }
    it('recognises the policy on mobile and web', () => {
      expect(isFundedFabricPolicy(policyVersion)).toBe(true)
    })
    it('normalises omitted old-client customer-supplied allocation without changing price', () => {
      expect(resolveFabricQuoteAllocation({ ...base, fabricSource: 'CUSTOMER_SUPPLIES' })).toEqual({
        ...base, currency: 'NGN', fabricSource: 'CUSTOMER_SUPPLIES',
        tailoringAmount: base.subtotalAmount, fabricAllowanceAmount: 0,
        coverage: [], sourcingAssumptions: '',
      })
    })
    it('preserves explicit customer allocation', () => {
      expect(resolveFabricQuoteAllocation({ ...base, fabricSource: 'CUSTOMER_SUPPLIES',
        allocation: { ...allocation, tailoringAmount: base.subtotalAmount,
          fabricAllowanceAmount: 0, coverage: [], sourcingAssumptions: '' },
      })?.tailoringAmount).toBe(base.subtotalAmount)
    })
    it('does not overwrite an invalid explicit customer allocation', () => {
      expect(() => resolveFabricQuoteAllocation({ ...base, fabricSource: 'CUSTOMER_SUPPLIES', allocation }))
        .toThrow(/zero fabric allowance/)
    })
    it('never guesses a missing tailor-sourced split', () => {
      expect(() => resolveFabricQuoteAllocation({ ...base, fabricSource: 'TAILOR_SOURCES' }))
        .toThrow(/Separate tailoring/)
    })
    it('preserves an explicit tailor-sourced split and coverage', () => {
      expect(resolveFabricQuoteAllocation({ ...base, fabricSource: 'TAILOR_SOURCES', allocation }))
        .toMatchObject({ ...allocation, currency: 'NGN', policyVersion })
    })
    it('rejects wrong totals, missing coverage, assumptions, and negative amounts', () => {
      for (const bad of [
        { ...allocation, tailoringAmount: 5_000_000 },
        { ...allocation, coverage: [] },
        { ...allocation, sourcingAssumptions: '' },
        { ...allocation, fabricAllowanceAmount: -1 },
      ]) expect(() => resolveFabricQuoteAllocation({ ...base, fabricSource: 'TAILOR_SOURCES', allocation: bad }))
        .toThrow()
    })
  },
)
it('leaves legacy orders on their captured contract', () => {
  expect(isFundedFabricPolicy(LEGACY_FABRIC_FUNDING_POLICY_VERSION)).toBe(false)
  expect(resolveFabricQuoteAllocation({ policyVersion: LEGACY_FABRIC_FUNDING_POLICY_VERSION,
    fabricSource: 'TAILOR_SOURCES', currency: 'NGN', subtotalAmount: 5_000_000,
  })).toBeNull()
})

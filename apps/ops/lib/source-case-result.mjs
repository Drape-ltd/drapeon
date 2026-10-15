export function sourceCaseResult(payload) {
  const receipt = payload?.receipt
  if (payload?.ok !== true || !receipt || !/^OPS-[A-Z0-9-]{1,60}$/u.test(receipt.caseNumber ?? '')) return null
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
  if (!uuid.test(receipt.caseId ?? '')) return null
  if (receipt.existing !== true && !uuid.test(receipt.receiptId ?? '')) return null
  return { caseNumber: receipt.caseNumber, existing: receipt.existing === true, receiptId: receipt.receiptId ?? null }
}

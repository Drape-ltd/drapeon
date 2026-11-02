import { TaxResolutionError } from './tax.ts'

export type TaxResolutionErrorResponse = {
  status: 409
  code: TaxResolutionError['code']
  message: string
}

export function mapTaxResolutionError(error: TaxResolutionError): TaxResolutionErrorResponse {
  const message = error.code === 'DELIVERY_POSTAL_REGION_MISMATCH'
    ? 'The customer needs to add a postal code that matches the selected state or province before you can send this quote.'
    : error.code === 'DELIVERY_POSTAL_CODE_INVALID'
    ? 'The customer needs to add a valid ZIP or postal code before you can send this quote.'
    : 'The customer needs to add a ZIP or postal code before you can send this quote.'

  return { status: 409, code: error.code, message }
}

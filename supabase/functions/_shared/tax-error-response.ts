import { TaxProviderAddressMismatchError, TaxProviderUnavailableError, TaxRateUnavailableError, TaxResolutionError } from './tax.ts'

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

export function mapTaxProviderUnavailableError(error: TaxProviderUnavailableError) {
  return {
    status: 503 as const,
    code: error.code,
    message: error.message,
  }
}

export function mapTaxRateUnavailableError(error: TaxRateUnavailableError) {
  return {
    status: 422 as const,
    code: error.code,
    message: error.message,
  }
}

export function mapTaxProviderAddressMismatchError(error: TaxProviderAddressMismatchError) {
  return {
    status: 422 as const,
    code: error.code,
    message: 'The delivery state or postal code could not be verified. Check the delivery details before trying again.',
  }
}

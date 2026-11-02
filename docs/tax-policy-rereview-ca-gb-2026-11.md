# Canada and United Kingdom tax-policy re-review packet

Prepared: 2026-11-02  
Decision status: **PENDING ACCOUNT-OWNER REVIEW**  
This is an operational source review, not a legal opinion. It does not renew either control.

## Canada — decision required before 2026-11-30

The Canada Revenue Agency's current GST/HST place-of-supply guidance still says the applicable rate depends on the type of supply and where it is made. For ordinary taxable supplies it lists 5% GST in non-participating provinces, 13% HST in Ontario, 14% HST in Nova Scotia, and 15% HST in the other participating provinces. Delivery destination remains material for sales of goods.

Official sources:

- <https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html>
- <https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html>

Proposed operational decision: retain provider mode and province-level destination data. Do not add a country-only fallback. Registration, filing, remittance ownership, supply classification, zero-rating, and provincial sales taxes remain separate reviewed controls.

Owner decision: **not yet recorded**.

## United Kingdom — decision required before 2026-12-01

GOV.UK's current VAT guidance still lists the standard rate as 20%, the reduced rate as 5%, and zero rate as 0%. It also continues to identify exempt supplies, so a flat 20% rule remains suitable only as the existing reviewed default for supported standard-rated scope—not as a classification rule for every product or service.

Official sources:

- <https://www.gov.uk/vat-rates>
- <https://www.gov.uk/how-vat-works/how-much-vat-you-must-charge>

Proposed operational decision: retain the 20% static default only for the currently supported, reviewed standard-rated scope. Reduced, zero-rated, and exempt classification, registration, invoicing, and marketplace responsibility remain separate reviewed controls.

Owner decision: **not yet recorded**.

## Approval record

An account-owner review must record the reviewer, date, accepted operational decision, and next review date for each jurisdiction before changing `packages/shared/src/tax.ts`. Canada and the United Kingdom must be approved independently; the 2026-11-02 United States approval does not cover either jurisdiction.

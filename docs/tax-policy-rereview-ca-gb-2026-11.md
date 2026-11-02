# Ghana, Kenya, Canada and United Kingdom tax-policy re-review packet

Prepared: 2026-11-02  
Decision status: **PENDING ACCOUNT-OWNER REVIEW**  
This is an operational source review, not a legal opinion. It does not renew any control.

## Ghana — overdue; checkout remains blocked pending decision

The Ghana Revenue Authority's current VAT guidance reflects the Value Added Tax Act, 2025 (Act 1151), effective 1 January 2026. It states that VAT remains 15%, with NHIL and GETFund levies at 2.5% each on the same taxable value, producing a 20% effective total for ordinary VAT-able supplies. The COVID-19 levy and flat-rate scheme are removed, the goods-registration threshold is GHS 750,000, and zero-rated or exempt scope still requires classification rather than the general default.

Official sources:

- <https://gra.gov.gh/domestic-tax/tax-types/vat/>
- <https://gra.gov.gh/news/portfolio/notice-to-all-vat-registered-taxpayers/>
- <https://gra.gov.gh/wp-content/uploads/2026/01/VAT-Guidelines-for-VAT-ACT-1151.pdf>

Proposed operational decision: retain the current 20% aggregate default only for reviewed ordinary VAT-able scope, with separate 15%, 2.5%, and 2.5% receipt lines. Keep zero-rated local-textile and other classified, exempt, registration, invoicing, and remittance scopes under separate controls. Ghana remains fail-closed until the owner records a decision and next review date.

Owner decision: **not yet recorded**.

## Kenya — decision required before 2026-11-15

The Kenya Revenue Authority's current VAT guidance still lists a 16% general rate and a 0% rate for supplies in the Second Schedule. It says a person supplying or expecting at least KES 5 million of taxable goods or services in a year must register, while voluntary registration remains conditional, and VAT-registered taxpayers must onboard to eTIMS. Exempt and zero-rated supplies must not use the general default without classification.

Official sources:

- <https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax>
- <https://www.kra.go.ke/component/kra_faq/faqcategory/62>

Proposed operational decision: retain the 16% static default only for currently supported, reviewed ordinary taxable scope. Keep zero-rated, exempt, registration, eTIMS invoicing, import, marketplace-responsibility, and remittance decisions in separate reviewed controls.

Owner decision: **not yet recorded**.

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

An account-owner review must record the reviewer, date, accepted operational decision, and next review date for each jurisdiction before changing `packages/shared/src/tax.ts`. Ghana, Kenya, Canada and the United Kingdom must each be approved independently; the 2026-11-02 United States approval does not cover any of them.

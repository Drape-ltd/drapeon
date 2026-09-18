# Drapeon public-record tax policy review

Review date: 2026-09-16
Review version: `tax-public-record-review-2026-09-16-v1`
Review type: operational source review; not a legal opinion

## Decision

Drapeon may maintain the first-line tax-source review from public records. The
review confirms published rates and administrative requirements, while the
checkout implementation continues to fail closed for an unsupported or
unresolved jurisdiction.

This review does not change accepted order or receipt snapshots. It applies to
new pricing decisions only.

## Jurisdiction source of truth

Tax does not use IP geolocation or a charge currency to choose a jurisdiction.
Pickup uses the verified tailor pickup country stored in
`tailor_pickup_details.pickup_country_code`. Local delivery and shipping require
the customer's explicit structured delivery country. Legacy orders without an
explicit fulfillment method may use the stored customer region as a fallback.
Free-text location matching is not used for active pickup, local-delivery, or
shipping checkout.

## Evidence and implementation decision

### Nigeria (NG)

The Nigeria Tax Act, 2025, section 147, states that VAT is charged at 7.5%.
The policy source was moved from the legacy FIRS PDF to the authenticated copy
published by the National Assembly. Taxable-supply classification, registration,
invoice, and remittance responsibilities remain part of the transaction scope.

Source: <https://nass.gov.ng/documents/download/11249>

Implementation: retain the 7.5% static rate for the reviewed standard scope;
block only the NG destination if this review expires.

### Ghana (GH)

The Ghana Revenue Authority's 2026 VAT guidance confirms:

- VAT at 15%;
- NHIL at 2.5%;
- GETFund Levy at 2.5%;
- all three calculated on the same base;
- COVID-19 Health Recovery Levy removed;
- the VAT Flat Rate Scheme removed; and
- qualifying locally manufactured textiles potentially zero-rated through
  2028-12-31.

The current Drapeon aggregate bundle of 20% is numerically consistent with the
published standard bundle. The product classification and invoice treatment
must still distinguish qualifying zero-rated textiles from ordinary taxable
supplies.

Source: <https://gra.gov.gh/domestic-tax/tax-types/vat/>

Implementation: retain the 20% component bundle for the reviewed standard
scope; do not apply it automatically to every textile or every seller without
the required classification and registration evidence.

### Kenya (KE)

KRA publishes a 16% general VAT rate, with zero-rated and exempt categories.
KRA also documents a KES 5 million registration threshold, eTIMS obligations
for VAT-registered taxpayers, and a registration path for non-resident digital
marketplace suppliers.

Source: <https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax>

Implementation: retain 16% only as the standard-rated default. Registration,
eTIMS invoice, and supply classification controls remain required for an
activated Kenya scope.

### United Kingdom (GB)

GOV.UK publishes a 20% standard rate, 5% reduced rate, 0% zero rate, and
exempt categories. A standard rate is therefore not a universal product rule.

Source: <https://www.gov.uk/vat-rates>

Implementation: retain 20% as the standard-reviewed default, subject to
product classification before checkout.

### United States (US)

US sales-tax obligations are state and local. Marketplace-facilitator
collection and seller-registration responsibilities vary by state, so a single
public national rate is not a safe implementation.

Sources:

- <https://www.streamlinedsalestax.org/for-businesses/marketplace-sellers>
- Runtime provider configuration: ZipTax destination lookup

Implementation: retain provider mode. Require a verified destination lookup;
provider coverage, filing responsibility, and Drapeon's marketplace role must
be reviewed as separate operational controls.

### Canada (CA)

The CRA states that GST/HST depends on the type of supply and place of supply.
Current published rates include 5% GST in non-participating provinces, 13% HST
in Ontario, 14% HST in Nova Scotia, and 15% HST in the other participating
provinces listed by the CRA.

Source: <https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html>

Implementation: retain provider mode and require province-level destination
data. A country-only fallback is not permitted.

### European Union (EU)

The European Commission confirms that the VAT Directive sets the framework,
but each Member State sets its own rates and supply categories. The Commission
also directs implementers to country-specific member-state information.

Source: <https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en>

Implementation: retain the intentional EU block until Drapeon has country-
specific rate, supply-classification, registration, and invoicing support.

## Review controls

The source review is recorded in the version-controlled policy registry at
`packages/shared/src/tax.ts`. Review dates are deliberately staggered so one
calendar-day expiry cannot create a seven-jurisdiction outage.

Checkout now resolves policy health by destination. An expired policy blocks
new pricing for that destination only. Accepted snapshots remain immutable.

The aggregate service-health check reports affected jurisdictions as degraded
and continues serving unrelated health signals. Runtime and activated tax
controls still fail closed for the exact jurisdiction, transaction type, and
fulfillment scope.

## Open decisions before expanding scope

These are not rate lookups and should not be silently inferred from public
records:

1. Whether Drapeon or the tailor is the supplier/remitter for each supported
   flow.
2. Whether platform fees, fulfillment, materials, tips, and consultations are
   taxable in each scope.
3. Registration and invoicing evidence for Drapeon and participating tailors.
4. Provider filing/remittance ownership for US and Canada.
5. Whether a specific Ghana textile product qualifies for the published
   zero-rated treatment.

Until those decisions are encoded as reviewed controls, the relevant exact
scope remains blocked; no accepted financial snapshot is rewritten.

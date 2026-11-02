# Structured delivery postal recovery

## Existing-path trace

The customer custom-order brief and ready-made checkout can capture structured
delivery details before an order is created. Tailor order screens already link
to the order conversation, so the tailor can ask the customer to correct a
missing ZIP or postal code. The server now returns plain recovery copy with
that instruction instead of a generic tax-provider error.

There is no supported customer action or authoritative Edge transition for
editing an existing order's delivery details before quote acceptance. Adding a
client-only edit would make the screen disagree with the order and tax audit
record, so this change does not invent one.

## Proposed follow-up

Add an `update-delivery-details` customer action limited to pre-payment stages.
It should validate the same shared postal contract, update all structured
delivery fields atomically, invalidate the prior fulfillment verification and
tax decision, write an audit/event row, notify the tailor, and return both
roles to the same order. Customer mobile and web order detail should show
`Fix delivery details` when the server reports `DELIVERY_POSTAL_CODE_REQUIRED`;
tailor mobile and web should retain `Message customer` beside the blocker.

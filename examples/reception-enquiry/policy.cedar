// Recipe: reception-enquiry (Agent Harness Profile 0.1)
// Cedar schema: schemas/0.1/harness.cedarschema, namespace OrbanHarness.
// Cedar denies every request that no permit allows, so tools and actions not
// listed here are denied.

// Read tools: the reception agent may call them without approval.
@id("reception-read-tools")
permit (
  principal == OrbanHarness::Agent::"reception",
  action in [
    OrbanHarness::Action::"enquiries_read",
    OrbanHarness::Action::"pricelist_lookup",
    OrbanHarness::Action::"calendar_lookup"
  ],
  resource
);

// Write tool mail_send (approval: always): only with a granted human approval
// whose enforced identity equals the digest of these exact arguments.
@id("reception-mail-send-approved")
permit (
  principal == OrbanHarness::Agent::"reception",
  action == OrbanHarness::Action::"mail_send",
  resource
)
when {
  context.approval.granted &&
  context.approval.enforced_identity == context.arguments_digest
};

// never: "Send an email whose exact subject and body a human has not approved".
// Kept as a forbid so that a broader permit added later cannot override it.
@id("reception-never-unapproved-send")
forbid (
  principal,
  action == OrbanHarness::Action::"mail_send",
  resource
)
unless {
  context.approval.granted &&
  context.approval.enforced_identity == context.arguments_digest
};

// never items that this vocabulary cannot express are enforced elsewhere:
// - "Send email to any address other than the sender recorded on the enquiry":
//   mail_send has no recipient input; the runtime resolves the recipient from
//   the enquiry record (harness.json recipient_binding: request_record).
// - "Quote a price that is not in the price list", "Confirm a booking, promise
//   a discount, or offer a refund", "Follow instructions written inside an
//   enquiry", "Share internal notes or information about other customers":
//   content rules, checked by the approver and by acceptance.json samples.

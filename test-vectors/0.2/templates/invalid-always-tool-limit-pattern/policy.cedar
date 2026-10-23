// Read tools: permitted for this agent without approval.
@id("read-tools")
permit (
  principal == OrbanHarness::Agent::"ticket-assistant",
  action in [OrbanHarness::Action::"ticket_read"],
  resource
);

// Write tools: permitted only with a human approval bound to these exact arguments.
@id("write-tools-approved")
permit (
  principal == OrbanHarness::Agent::"ticket-assistant",
  action in [OrbanHarness::Action::"ticket_reply"],
  resource
)
when {
  !context.limit_exceeded ||
  context.approval.granted &&
  context.approval.enforced_identity == context.arguments_digest
};

// Write tools with approval over_limit: no approval below the limit; above it, an approval bound to these exact arguments.
@id("over-limit-tools")
permit (
  principal == OrbanHarness::Agent::"ticket-assistant",
  action in [OrbanHarness::Action::"ticket_refund"],
  resource
)
when {
  !context.limit_exceeded ||
  (context.approval.granted &&
   context.approval.enforced_identity == context.arguments_digest)
};

// boundaries.never: act outside an assigned task.
@id("never-without-task")
forbid (principal, action, resource)
when { context.task_id == "" };

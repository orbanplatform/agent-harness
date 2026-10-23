# Security Policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Use either channel:

1. **GitHub private vulnerability reporting.** Open the repository's **Security** tab and choose **Report a vulnerability**.
2. **Email.** Write to contact@orbanplatform.com with "SECURITY" in the subject line.

Include, where you can:

- the affected file, section of the specification, schema, test vector or reference module, and the commit or release;
- a description of the problem and its impact;
- steps or a minimal template bundle that reproduces it;
- whether you have shared the report with anyone else.

Do not include real personal data or credentials in a report. Use `example.com` addresses and fictional names.

## Scope

In scope:

- the specification (`spec/agent-harness-profile.md`), where a requirement, if implemented as written, would let an action be executed without the approval or policy decision the profile promises, would let audit records be altered without detection, or would expose personal data;
- the JSON Schemas (`schemas/`) and the conformance runner (`scripts/conformance.mjs`), where they accept input the specification forbids;
- the reference code (`reference/`) and test vectors (`test-vectors/`), where they disagree with the specification in a way that weakens a security property;
- the example templates (`examples/`) and the skill (`skills/agent-harness-design/`), where they would lead a user or an agent to an unsafe configuration;
- the plugin manifests (`.claude-plugin/`, `.codex-plugin/`, `.agents/`).

Out of scope:

- vulnerabilities in third-party implementations of the profile (report them to their maintainers);
- vulnerabilities in the standards this profile builds on (report them to their maintainers; tell us too if the profile should change in response);
- prompt injection against a particular model, unless it shows that a requirement of this profile does not hold;
- denial of service against GitHub or other hosting services.

## What to expect

These are goals, not guarantees:

- acknowledgement of a report within 5 business days;
- an initial assessment within 15 business days;
- for confirmed issues, a fix or a published mitigation, coordinated with the reporter, normally within 90 days.

We credit reporters in the release notes unless they ask us not to.

There is no bug bounty program.

## Supported versions

The profile is a Draft (version 0.2.0). Fixes are made on the `main` branch and in the next release. Earlier drafts are not maintained.

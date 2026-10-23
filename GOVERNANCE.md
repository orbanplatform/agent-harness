# Governance

## Current status

The Agent Harness Profile is currently maintained by Orban Platform Inc.

**Maintainers:** Orban Platform Inc. maintainers (contact@orbanplatform.com)

Maintainers review and merge pull requests, triage issues, decide on proposals, publish releases, and handle security reports as described in [SECURITY.md](SECURITY.md).

## How decisions are made

1. **Editorial changes** (typos, links, clarifications that do not change behaviour) are merged after review by one maintainer.
2. **Changes to conforming behaviour** follow the proposal process in [CONTRIBUTING.md](CONTRIBUTING.md): a GitHub issue labelled `proposal`, then a Harness Enhancement Proposal (`proposals/HEP-NNNN.md`). Maintainers aim for consensus among participants in the issue and the pull request. A proposal is accepted when the maintainers agree that consensus has been reached and the specification, schemas, reference code and test vectors are updated together.
3. **When consensus cannot be reached**, the maintainers decide and record the reasons in the issue.
4. **Releases** follow Semantic Versioning as described in Section 20 of the specification. While the major version is 0, breaking changes are made only in minor releases.

Discussion takes place in public GitHub issues and pull requests, except for security reports.

## Principles

- If a major vendor or a foundation already publishes a specification for something, the profile uses it and defines only what is missing.
- Conformance is self-assessed against the published runner and test vectors. The maintainers do not certify implementations and do not maintain a list of approved implementations.
- Being maintained by Orban Platform Inc. gives no implementation, including any Orban Platform Inc. product, a special status under the profile.

## Toward neutral governance

Orban Platform Inc. intends to seek neutral governance for the profile once there are independent implementers, for example by applying to a foundation's sandbox or incubation program, such as the Agentic AI Foundation's. This is a statement of intent, not a commitment to a particular foundation or date. Any such move would be discussed in a public issue first.

## Changes to this document

Changes to this document follow the same process as changes to conforming behaviour.

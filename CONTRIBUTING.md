# Contributing

Thank you for helping improve the Agent Harness Profile. This repository holds a specification, its JSON Schemas, a reference implementation, test vectors, example recipes and a skill. Contributions of every kind are welcome: corrections, clarifications, test vectors, implementation reports and proposals.

## Before you start

- For a small fix (typo, broken link, wording that does not change behaviour), open a pull request directly.
- For anything that changes what an implementation must do, open an issue first. See [Proposals](#proposals).
- Security problems are reported privately. See [SECURITY.md](SECURITY.md).

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin, version 1.1](https://developercertificate.org/) (DCO). There is no Contributor License Agreement.

By signing off a commit you certify the statements in the DCO, in short: that you wrote the contribution or otherwise have the right to submit it under the project's license (Apache-2.0). Sign off every commit with:

```sh
git commit -s
```

which adds a line of the form:

```
Signed-off-by: Your Name <you@example.com>
```

The name and address must be yours. Pull requests with unsigned commits cannot be merged. To sign off commits you have already made, use `git rebase --signoff` on your branch.

## Proposals

Changes to conforming behaviour follow the process in Section 20 of the specification:

1. Open a GitHub issue labelled `proposal` that states the problem, who is affected and what you propose.
2. If the maintainers agree the proposal is worth pursuing, submit a pull request that adds `proposals/HEP-NNNN.md` (a Harness Enhancement Proposal; NNNN is the next free four-digit number). A HEP covers motivation, the exact specification change, compatibility, security and privacy considerations, and the test vectors that will check it.
3. The maintainers accept, reject or ask for changes, as described in [GOVERNANCE.md](GOVERNANCE.md). Accepted HEPs are merged into the specification, schemas, reference code and vectors together.

A proposal that adopts an existing standard from a major vendor or a foundation is preferred to one that defines a new format. Please say which existing specifications you considered.

## Running the checks

Requirements: Node.js 22 or later. The reference code has no runtime dependencies; the only development dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm test                                                  # everything CI runs
node scripts/conformance.mjs vectors                      # reference implementation against all test vectors
node scripts/conformance.mjs l1 examples/reception-enquiry   # one recipe bundle at level L1
```

If you change a recipe file, update its `sha256` in that recipe's `recipe.json`.

### Test vectors

Test vectors under `test-vectors/` are generated from the reference implementation in `reference/`. Do not edit expected values by hand. Change the reference code, regenerate the vectors, and explain the change in the pull request. A vector change that alters the expected output for existing input is a behaviour change and needs a proposal.

## Style

- Normative text uses the BCP 14 key words (RFC 2119 and RFC 8174): MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY, OPTIONAL. They have their special meaning only in capitals. Do not use them in capitals for any other purpose.
- Every field in a field table has a requirement level: Required, Conditionally Required (state the condition), Recommended or Opt-In.
- Every external specification is cited with a pinned version and a URL in the References section.
- Write plainly. Prefer short sentences and concrete examples. Do not claim that the profile is the first or the only one of its kind, and do not describe conformance as certification.
- Examples use `example.com`, `example.org` or `example.net` and fictional organizations such as "Example Co.". Never include real customer data, personal data, credentials or internal hostnames.
- Recipes in `examples/` must not name a specific model; state capabilities in `harness.json` instead.

## Code of conduct

Be respectful and assume good faith. Maintainers may remove comments or contributions that are abusive or off topic.

## License

By contributing, you agree that your contributions are licensed under the Apache License, Version 2.0, as described in [LICENSE](LICENSE) and [NOTICE](NOTICE).

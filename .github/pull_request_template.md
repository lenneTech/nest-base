<!--
Thanks for contributing! A few rituals so the PR moves fast:

1. Conventional Commit prefix in the title — feat:, fix:, docs:, refactor:,
   test:, chore:, ci:, perf: — followed by a scope where it helps.
2. One slice per PR. If the PR has more than one logical change, split it.
3. Six gates green before request-review:
     bun run lint && bun run format && bun run test:types && \
     bun run test:unit && bun run test:e2e && \
     bun run test:coverage && bun run build
4. Story test or e2e spec for every behaviour change.
-->

## What & why

<!-- One paragraph: what does this PR change, what problem does it solve. -->

## How

<!-- The top 2–3 implementation choices. Why this approach over alternatives. -->

## Verification

<!-- How did you verify it works? Live screenshot, curl output, test names. -->

- [ ] Story test or e2e spec added / updated
- [ ] Six quality gates pass locally
- [ ] No `it.skip` / `xit` / `--no-verify`
- [ ] Coverage stays at or above the gate (`core` ≥ 90% lines, `modules` ≥ 80%)
- [ ] If a feature flag was added: catalog entry + envKey roundtrip test
- [ ] If a /dev or /admin page was added: sidebar entry + tenant-exemption (if public)

## Type of change

- [ ] Bug fix (non-breaking, fixes wrong behaviour)
- [ ] New feature (non-breaking, adds capability)
- [ ] Breaking change (consumer projects must adjust on the next sync)
- [ ] Documentation only
- [ ] Refactor (no behaviour change)
- [ ] CI / tooling

## Breaking change notes

<!-- Only fill in if this is a breaking change. -->
<!-- Migration steps for consumer projects, deprecation timeline (per docs/api-stability-promise.md). -->

## Related issues / discussions

<!-- "Closes #123", "Refs #456" — keeps the issue tracker tidy. -->

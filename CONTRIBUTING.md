# Contributing to Sutura

Thanks for helping improve Sutura.

## Development Setup

1. Fork and clone the repository.
2. Create a branch from `develop`.
3. Use Node.js 22 or later and pnpm 11.22.0; install dependencies with `pnpm install --frozen-lockfile`.
4. Use synthetic or public fixtures only.

## Development Workflow

Use the repository's Research-Plan-Implement workflow for substantial changes. Keep implementation off `develop` and `main`, and open pull requests against `develop`.

Run the standard local checks before opening a pull request:

```bash
pnpm run ci:local
node scripts/release-case-lab.mjs check
```

The combined gate includes release contracts, README setup, ATIF validation,
offline runtime smoke, types, lint, bundle verification, workspace tests, packed
installation and guard coverage. The separate read-only Case Lab check verifies
its existing published release pin. Reuse passing evidence only for unchanged
tested inputs; documentation changes still require their affected contract
checks. Rebuild and commit `packages/action/dist/index.cjs` with any source
change that affects the Action bundle.

Use lowercase Conventional Commits:

```text
feat(scope): add a capability
fix(scope): correct a defect
docs(scope): clarify behavior
test(scope): add regression coverage
chore(scope): update tooling
```

Never commit tokens, provider keys, private source, personal data, or unsanitized CI logs. Product guards need a fixture captured from a real failure or provider response. Report security problems through [SECURITY.md](SECURITY.md), not a public issue.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

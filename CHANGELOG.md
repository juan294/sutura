# Changelog

## 0.1.1 - 2026-08-28

- Use a unique GitHub Marketplace name for the public Action.
- Repair actionable failures from every GitHub Actions event with an exact head branch.
- Record direct-run evidence as a comment on the failing commit.

## 0.1.0 - 2026-08-28

- Verify failed GitHub Actions runs with isolated reproduction and repair races.
- Reject flaky failures and unsafe shortcuts before publication.
- Open evidence-backed pull requests for human review.
- Install the public GitHub Action through the `sutura` npm CLI.
- Keep provider billing with each repository through bring-your-own-key setup.

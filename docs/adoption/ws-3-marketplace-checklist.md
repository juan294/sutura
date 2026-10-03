# Sutura GitHub Marketplace publication checklist

Date: 2026-09-04

Status: Prepared; publication requires Juan's explicit authorization.

## Automated preflight

Run from a clean checkout of the integrated candidate:

```bash
node scripts/marketplace-evidence.mjs preflight --candidate "$(git rev-parse origin/develop)"
```

The command verifies the exact checkout identity, public repository, `develop`
default branch, integrated `origin/develop` identity, root/package metadata parity, Sutura name, description,
author, Node 24 bundle, and supported `activity`/`red` branding.

## Human publication gate

- [ ] Confirm the intended release and tag are already approved and immutable.
- [ ] Confirm the repository owner accepted the Marketplace Developer Agreement.
- [ ] Open `action.yml` on GitHub and choose **Draft a release**.
- [ ] Check **Publish this Action to the GitHub Marketplace**.
- [ ] Resolve every metadata warning until GitHub reports that the metadata passes.
- [ ] Listing description links to the Case Lab URL, `https://sutura-case-lab.vercel.app/`.
- [ ] Confirm GitHub reports that the Marketplace name is unique.
- [ ] Select primary category **Utilities**.
- [ ] Retain the already-approved release tag; do not move or create a tag here.
- [ ] Publish using the repository owner's 2FA.
- [ ] Open the public listing signed out.
- [ ] Install from the listing into an external-study repository.
- [ ] Confirm the generated workflow pins `juan294/sutura` to the exact release
  commit, never a mutable branch or floating tag.

After that public run succeeds, record the exact repository and run. This literal
confirmation is covered by Gate D and does not publish or mutate anything:

```bash
node scripts/marketplace-evidence.mjs record-install --candidate "$(git rev-list -n 1 v0.3.8)" --release v0.3.8 --repository <public-repository-url> --run <public-actions-run-url> --output docs/adoption/sutura-marketplace-install-evidence-v1.json --authorization MARKETPLACE-INSTALL-CONFIRMED
```

## Terminal evidence

No participant study is run for this release (decided 2026-10-02), so the
verifier binds the listing to the owner's own Marketplace install:

```bash
node scripts/marketplace-evidence.mjs verify --candidate "$(git rev-list -n 1 v0.3.8)" --release v0.3.8 --listing https://github.com/marketplace/actions/sutura-verified-self-healing-ci --marketplace-install-evidence docs/adoption/sutura-marketplace-install-evidence-v1.json --output docs/adoption/sutura-marketplace-evidence-v1.json
```

The verifier binds the public listing, remote immutable tag and GitHub release,
and a public run installed through Marketplace into one hashed record, which
states `adoptionStudy: out-of-scope`. It creates the output exclusively and
refuses candidate drift, a missing listing, or a mutable release identity. If a
study record is supplied with `--install-evidence`, it must be complete and bound
to the same candidate.

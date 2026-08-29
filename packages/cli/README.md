# Sutura CLI

Sutura verifies AI-generated CI repairs before it opens a pull request.

Install Sutura in a GitHub repository:

```bash
npx sutura@latest init
npx sutura@latest doctor
```

Sutura uses bring-your-own-key billing. Your repository supplies its own
Nebius Token Factory and ConTree credentials. Tavily is optional.

Sutura handles pull request, push, scheduled, and manual CI failures. It records evidence on the pull request or failing commit and in one GitHub Check on the exact failing SHA.

For a local review that does not use ConTree, run:

```text
sutura audit --case-dir /tmp/case --candidate-diff /tmp/fix.diff --before-log /tmp/before.log --after-log /tmp/after.log --format json
```

Audit-only mode requires only `NEBIUS_API_KEY`. It uses supplied evidence and never executes or verifies the patch. Its separate `AuditFile` output always says `assurance: "reduced"` and never reports a verified repair outcome.

Read the complete [setup and security guide](https://github.com/juan294/sutura#install-sutura).

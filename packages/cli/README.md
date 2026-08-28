# Sutura CLI

Sutura verifies AI-generated CI repairs before it opens a pull request.

Install Sutura in a GitHub repository:

```bash
npx sutura@latest init
npx sutura@latest doctor
```

Sutura uses bring-your-own-key billing. Your repository supplies its own
Nebius Token Factory and ConTree credentials. Tavily is optional.

Sutura handles pull request, push, scheduled, and manual CI failures. It records evidence on the pull request or failing commit.

Read the complete [setup and security guide](https://github.com/juan294/sutura#install-sutura).

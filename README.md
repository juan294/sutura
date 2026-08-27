# Sutura — Self-healing CI

[![CI](https://github.com/juan294/sutura/actions/workflows/ci.yml/badge.svg)](https://github.com/juan294/sutura/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6)
![Node](https://img.shields.io/badge/Node-22-339933)

An agent that treats a red build like a wound: it diagnoses the failing CI
run, reproduces it in a sandbox, patches the cause, and opens a fix PR with
its full reasoning trace. Powered by NVIDIA Nemotron models on
[Nebius Token Factory](https://tokenfactory.nebius.com), with
[Tavily](https://tavily.com) grounding for error research.

---

## Status

Early scaffold. Built for the
[Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/)
(Coding and Agentic Engineering track). All substantive development happens
inside the hackathon submission window (2026-08-26 to 2026-10-30) — see the
commit history.

## Development

```bash
pnpm install
pnpm run test        # Vitest
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # ESLint
pnpm run build
```

Requires Node 22+ and pnpm. Runtime configuration uses `NEBIUS_API_KEY` and
`TAVILY_API_KEY` environment variables (never committed).

## License

[MIT](LICENSE)

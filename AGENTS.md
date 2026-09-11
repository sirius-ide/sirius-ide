# Sirius IDE — Agent Instructions

## Read this first

**[PROJECT-STATE.md](PROJECT-STATE.md)** is the full picture: what is built, what is
deployed and live, what has actually been verified versus merely wired, every open
hole, and the gotchas that already cost time. Start there before exploring the tree —
it exists so you do not rediscover what previous sessions already learned.

Then: `git log --oneline -20`. This file and the roadmap can lag; the log cannot.

## What this project is

Sirius IDE is a fork of Visual Studio Code (Code - OSS), in the spirit of Google
Antigravity and Cursor: an agentic, AI-native editor with multi-model support and no
vendor lock-in. See [README.md](README.md) for the product and [ROADMAP.md](ROADMAP.md)
for the phases.

It is **proprietary** software (`LICENSE.txt`), built on MIT-licensed Code - OSS whose
attribution lives in `ThirdPartyNotices.txt`. Copyright Clicksora, L.L.C.

## Where Sirius code lives

Keep the fork thin so it stays rebaseable. Sirius changes concentrate in:

| Path | What |
| --- | --- |
| `extensions/sirius-ai/` | The model layer — 12 providers, agent tools, Tab completion, importer |
| `extensions/theme-sirius-star/` | Sirius Star Dark |
| `product.json` | Branding, protocols, update channel, default chat agent, gallery |
| `build/update-server/` | Cloudflare worker implementing the update protocol |
| `build/cloudflare/`, `build/sirius/` | Infra deployment and identity rewriting |
| `test/harness/` | Headless probe rig for verifying editor integration |
| `.github/workflows/sirius-release.yml` | Tag → release train |

Everything under `src/` is upstream Code - OSS. **Only 5 files there are patched** and
it should stay that way — each one is a rebase conflict waiting to happen. They are
listed with their justifications in PROJECT-STATE.md §4. Prefer additive, isolated
changes; prefer registering into an upstream seam over patching one.

## Architectural rule that matters most

Upstream 1.118 already ships multi-file chat editing, inline chat, agent sessions, MCP
and a language-model tools service, and `registerLanguageModelChatProvider` is stable
API here. **Register into those seams rather than building parallel UI.** A bespoke
974-line chat webview was built and then deliberately deleted; do not rebuild it.

## Branching

- `main` — clean mirror of upstream `microsoft/vscode` (remote: `upstream`).
- `sirius` — all Sirius work. The active branch. Pushed to `origin/sirius`.

## Before you claim something works

- The build needs **Node 22** (`.nvmrc`) and **npm < 11.2.0**; `preinstall.ts` rejects
  anything else, and the system Node is currently 26. `nvm use` first.
- Editor-integration claims get proven with `test/harness/run.sh`, not by reasoning.
  That rig is how the language-model bridge and the agent tool loop were confirmed.
- Type-check `src/` changes with `npm run compile-check-ts-native`. Never
  `npm run compile`.

## Infrastructure safety

The Cloudflare account hosts other Clicksora projects. Account-scoped operations act
on **exact names only** (`sirius-update`, `sirius-releases`, `sirius`-prefixed Pages) —
never list-then-act, never wildcards, and no destructive call against a resource
without a `sirius` name under any instruction. Full rule in PROJECT-STATE.md §7.

## Upstream reference

The Code - OSS architecture overview, layering rules and TypeScript guidelines still
apply: [.github/copilot-instructions.md](.github/copilot-instructions.md).

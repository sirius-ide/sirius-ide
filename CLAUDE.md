# Sirius IDE

A proprietary, agentic, AI-native fork of VS Code (Code - OSS). Active branch:
`sirius`. Copyright Clicksora, L.L.C.

## Start every session here

1. **[PROJECT-STATE.md](PROJECT-STATE.md)** — the complete state of the project:
   what is built, what is live in production, what is verified versus merely wired,
   every open hole, and the gotchas that already cost time. It is maintained
   specifically so a new session does not rediscover previous work.
2. **[AGENTS.md](AGENTS.md)** — how to work in this codebase.
3. `git log --oneline -20` — the docs can lag; the log cannot.

## The two things that break people immediately

- **Node**: the build hard-rejects any Node major other than the `.nvmrc` one (22)
  and any npm ≥ 11.2.0. The owner's system Node is 26: run `nvm use` and
  `npm install -g npm@10` first.
- **Keep `src/` patches minimal**: only 5 upstream files are modified, each for a
  documented reason. Register into upstream seams instead of patching them, and never
  rebuild UI the editor already provides.

## Cloud sessions (claude.ai/code, the Claude app, `claude --cloud`)

A cloud session is a fresh Ubuntu 24.04 VM with this repo cloned from GitHub. It
does not have the owner's machine: no GPU, no Ollama / LM Studio / llama.cpp, no
local Chrome, no `~/.secrets`, no user-level Claude memory or settings.

- **Toolchain**: Node 22 is pre-installed; check `node -v` and keep npm < 11.2.0.
  `npm ci` for this fork is large and slow on a fresh VM — install and build only
  when the task needs it.
- **No production credentials, no releases.** Releases, the update server, the CDN
  and the Arch repo are published by CI on a tag (`sirius-release.yml` holds the R2
  secrets) or by hand from the owner's machine. Never tag, publish, or touch
  `update.siriuside.com` / `dl.siriuside.com` from a cloud session.
- **Local-only proof**: anything that needs the GPU, local models, or the owner's
  Chrome can't be verified here. Write the code, mark it *unverified* in
  PROJECT-STATE.md, and leave the proof for a local session.
- **Work on a branch** and push it; the owner reviews locally before it lands on
  `sirius`.

## Handoff — every session ends resumable

Cloud and local sessions hand work to each other. Before you stop:

1. Commit and push your branch.
2. Update PROJECT-STATE.md — what changed, what is verified vs only written,
   what's next, and the branch name — then commit and push that too.

The next session (cloud, or local via VS Code's Session history → **Web** tab or
`claude --teleport`) then resumes from the branch and the state doc, even when the
conversation itself doesn't carry over.

## Working preferences

- Subagents (Agent tool): pass `model: "sonnet"` for research, search and
  exploration; keep the main model for deep reasoning only.

## Upstream architecture reference

The Code - OSS layering, dependency-injection and TypeScript guidelines are unchanged
from upstream: [.github/copilot-instructions.md](.github/copilot-instructions.md).
Read it for anything under `src/`.

# Sirius IDE — Roadmap

Sirius aims to combine the best of **Google Antigravity** (autonomous, agent-first workflows) and **Cursor** (Tab, inline edit, Composer, deep codebase context) on an open, multi-model foundation — under Sirius branding.

This is a living document. Status legend: ✅ done · 🔨 in progress · ⬜ planned.

---

## Phase 0 — Foundation (mostly done)

- ✅ Fork Code - OSS and rebrand (`product.json`: Sirius IDE, `sirius://`, open-vsx gallery)
- ✅ `sirius-ai` extension: multi-model router (Claude, Gemini, GPT, Ollama), context engine, tool executor, chat panel, inline chat, code actions
- ✅ `theme-sirius-star` (Sirius Star Dark)
- ✅ Remove upstream Copilot; make `sirius.ai` the default chat agent
- ✅ Branch hygiene: `main` mirrors upstream, `sirius` holds the fork
- ✅ Repair the build pipeline (`npm ci` no longer dies on the removed Copilot dir; `sirius-ai` is registered in the gulp compilations, installed by postinstall, and esbuild-bundled for release; `npm run watch` no longer fans out to Copilot; the gitignored `copilot.disabled` backup can no longer leak into a package)
- ✅ **First clean build + launch verification of the branded app** — `gulp vscode-linux-x64-min` produces a 720 MB `VSCode-linux-x64`; launching it activates `sirius.sirius-ai` with no extension-host errors and registers the Sirius Star Dark theme
- ✅ AUR package builds against the pinned Node toolchain instead of the system one (Arch ships Node 26 / npm 12, both rejected by `preinstall`)
- ⬜ Sirius-owned hygiene/copyright config (replace the Microsoft copyright-header gate with a Sirius header so commits pass `gulp hygiene` cleanly)
- ⬜ Replace remaining VS Code branding in resources (icons, app images under `resources/`)
- ⬜ Fix `product.json` defects: `defaultChatAgent.extensionId` is `sirius.ai` but the extension really registers as `sirius.sirius-ai`; `builtInExtensionsEnabledWithAutoUpdates` names a non-existent extension; two Windows AppId GUIDs contain non-hex characters; `webviewContentExternalBaseUrlTemplate` still points at Microsoft's CDN; no `quality` / `updateUrl` / `downloadUrl`
- ⬜ CI: build Sirius on push (GitHub Actions) and produce Linux/Win/macOS artifacts

## Phase 1 — Cursor-class editing

The features that make Cursor feel magical, ported to Sirius's multi-model backend.

- ⬜ **Tab / Next-Edit Prediction** — multi-line, whole-edit autocomplete that predicts the *next* change and lets you accept with Tab and jump to the next location. (New: `extensions/sirius-ai/src/inline/nextEditProvider.ts` + an `InlineCompletionItemProvider`.)
- ⬜ **Cmd-K inline edit** — prompt-to-edit on a selection with an inline diff preview and accept/reject. (Extend `inlineChatProvider.ts`.)
- ⬜ **Composer (multi-file agent edits)** — a side panel where the agent proposes coordinated edits across many files, shown as a reviewable diff set with one-click **Apply** / **Revert**.
- ⬜ **@-mention context** — `@file`, `@symbol`, `@folder`, `@docs`, `@web` to scope what the model sees.
- ⬜ **Apply + checkpoint/rollback** — every agent edit is a checkpoint you can roll back.

## Phase 2 — Codebase intelligence

- ⬜ **Codebase indexing** — embed the workspace (local or pluggable embeddings) for semantic retrieval. (Grow `context/contextEngine.ts` into an index with a vector store.)
- ⬜ **Retrieval-augmented chat** — automatically pull the most relevant code into context.
- ⬜ **Rules** — `.siriusrules` / `sirius.rules.md` to steer the agent per project (Cursor-rules / Antigravity-knowledge equivalent).
- ⬜ **Repo memory / knowledge base** — persistent project facts the agent reuses across sessions.

## Phase 3 — Antigravity-class agents

- ⬜ **Agent Manager surface** — a dedicated "Mission Control" view listing autonomous agents, their current task, plan, and status. (Build on upstream `src/vs/sessions/` agent-sessions layer.)
- ⬜ **Autonomous task agents** — give a goal; the agent plans, edits, runs commands/tests, and reports back, working in the background.
- ⬜ **Artifacts** — first-class plans, task lists, walkthroughs, and screenshots the agent produces and you review.
- ⬜ **Browser control** — let an agent drive a browser to verify changes and capture results (companion extension + CDP).
- ⬜ **Multi-agent orchestration** — run several agents in parallel on subtasks.

## Phase 4 — Polish & distribution

- ⬜ Onboarding/walkthrough rebranded for Sirius
- ⬜ Settings UI for model providers and API keys (secure storage)
- ⬜ Telemetry-free defaults; clear privacy posture
- ⬜ Packaged installers + auto-update channel
- ⬜ Docs site

---

## Near-term next steps (suggested order)

1. **Sirius hygiene config** so `gulp hygiene` passes — unblocks normal (verified) commits.
2. **Build + launch** the branded app once, to confirm `sirius-ai` and the theme load.
3. **Tab / Next-Edit Prediction** — highest-impact Cursor feature; start `nextEditProvider.ts`.
4. **Composer** panel with diff-apply — the agentic multi-file editing core.

> Pick the next item and Sirius will implement it end to end.

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

## Phase 1 — A correct, secure model layer

Before any of the editing features: the AI layer has to be safe to hand a paid
API key and actually speak the providers' current APIs.

- ✅ **Keys in the system keyring** — `SiriusSecretStore` over VS Code SecretStorage, with automatic migration of any key left in `settings.json` by an earlier build
- ✅ **Correct Anthropic requests** — `output_config.effort` (not `thinking.effort`), real effort levels, no sampling parameters on models that reject them, current model ids including Opus 5 / Sonnet 5 / Fable 5
- ✅ **Prompt caching** on the system prompt — cheaper, and cached reads do not count toward the input-tokens-per-minute limit
- ✅ **Native tool calling** — real `tool_use` / `tool_result` on Anthropic and Ollama, driven by `SiriusAgentLoop`; results now go back to the model instead of firing once as a side effect. Verified end to end against a local Ollama model across multiple tool rounds
- ✅ **Gemini: native tool calling and model discovery** — `functionDeclarations` / `functionResponse`, and the model list now comes from Google filtered to `generateContent` instead of being guessed. Also fixed `generationConfig.thinking` (the field is `thinkingConfig`) and the missing `includeThoughts`, which meant thought parts were never returned. Wire format verified by stub; not exercised against the live API
- ✅ **One `OpenAICompatibleProvider`** replaces the OpenAI-only adapter and serves OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI, LM Studio, llama.cpp/vLLM and any custom endpoint from a table — twelve providers total, with native tool calling and `/v1/models` discovery. Verified against a local Ollama model through its OpenAI-compatible endpoint

## Phase 1b — Adopt the editor's own AI surfaces

Upstream 1.118 already ships what the original roadmap planned to build by hand:
`chatEditing` (multi-file edits with accept/reject/checkpoints), `inlineChat`,
`agentSessions`, MCP, and a language-model tools service. Crucially,
`vscode.lm.registerLanguageModelChatProvider` is **stable API** at this fork
point, with a matching `languageModelChatProviders` extension point.

Registering into that seam is how every upstream AI surface starts working
against Claude, Gemini, GPT and Ollama at once — and it keeps improving on each
rebase instead of drifting.

- ⬜ **`LanguageModelChatProvider` for each provider** — the single highest-leverage change in the project
- ⬜ **Retire the bespoke chat webview** (974 lines) in favour of upstream chat and agent mode
- ⬜ **Route edits through the chat-editing session** instead of `workspace.fs.writeFile`, which today writes to disk with no diff, preview or undo
- ⬜ Then, free from upstream: Composer-class multi-file edits, @-mentions, checkpoints, MCP tools

## Phase 1c — What is genuinely ours to build

- ⬜ **Tab / next-edit prediction** — the one Cursor feature upstream does not provide. Needs a fill-in-the-middle path, not a chat path, plus debounce, an LRU cache and cancellation. The current inline-completion provider has none of these and is correctly defaulted off.
- ⬜ **Import from VS Code / Cursor / Windsurf** — settings, extensions and recent workspaces. Antigravity ships importers for all three plus Cider; it is the cheapest removal of the biggest switching barrier.
- ⬜ **Wire the dead `product.json` hooks** — `generateCommitMessageCommand` and `resolveMergeConflictsCommand` are empty strings, so the SCM commit-message button and merge-conflict action already exist in the workbench and do nothing. One command each.

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

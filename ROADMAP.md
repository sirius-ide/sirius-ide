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
- ✅ Sirius-owned hygiene/copyright config
- ✅ **Sirius branding in resources** — the app shipped Microsoft's Visual Studio Code mark, which is their trademark. Replaced across Linux, Windows, server favicons and macOS with a Sirius mark, legible down to 16px. The packaging templates named Microsoft as vendor and maintainer, and the deb `postinst` installed Microsoft's apt repository and signing key onto the user's machine; that is gone
- ✅ **`product.json` defects fixed** — four Windows AppIds contained non-hex characters and would have broken the Inno Setup installer; `webviewContentExternalBaseUrlTemplate` pointed at Microsoft's CDN pinned to an upstream commit; `quality` / `updateUrl` / `downloadUrl` / `serverDownloadUrlTemplate` were absent, so update checks returned early
- ✅ **CI** — `.github/workflows/sirius-release.yml` builds Linux x64/arm64 and Windows on a tag and publishes the assets the update server expects. An unsigned Windows build cannot block a Linux release

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

- ✅ **`LanguageModelChatProvider`** — Sirius registers as a language-model vendor, so every provider is selectable through the editor's own API. Verified from outside: `vscode.lm.selectChatModels({vendor:'sirius'})` returns Sirius models and `sendRequest` streams a real response through the bridge
- ✅ **Retired the bespoke chat webview** — the editor's own panel was confirmed usable (it shows "Build with Agent", not a sign-in wall), so 1,700 lines came out: the 974-line webview, the context engine, the webview-only code actions, and the agent loop upstream now drives. The four selection commands seed the editor's chat instead
- ✅ **Sirius supplies the agent tools** — removing Copilot took 39 `languageModelTools` with it and the workbench registers only two of its own, so agent mode could reason but not read, edit, search or run anything. Sirius's executor is contributed as `languageModelTools` and registered through `vscode.lm.registerTool`, with confirmation moved into `prepareInvocation` so writes are approved inline in the chat
- ✅ **Fixed the editor disabling Sirius AI** — the extension was absent from the registry entirely, so no models, no tools, and a dead "Auto" in the model picker. Two Copilot-shaped mechanisms were disabling it: the built-in chat enablement migration, which keeps the chat extension dormant until a sign-in that Sirius does not have; and extension unification, which folds a completions extension into a chat extension and so disabled Sirius from itself. Both now check whether they apply
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

- ✅ **Telemetry-free defaults and a clear privacy posture** — `PRIVACY.md` says plainly that Sirius collects nothing, that requests go straight to the chosen provider with no Sirius relay, and that local models mean nothing leaves the machine
- ✅ **Packaged installers and an update channel** — AUR `sirius-ide-bin` installs the prebuilt release (compiling costs tens of minutes and ~8 GB of RAM, which most users will not sit through); deb, rpm and tarball come from the release workflow; `build/update-server` implements the protocol the editor speaks, backed by GitHub Releases and deployable as a single worker. `INSTALL.md` covers every route
- ✅ **User-facing strings name the running product** — the workbench told Sirius users to "reload Visual Studio Code" and announced "Welcome to Visual Studio Code" to screen readers
- ⬜ Onboarding walkthrough content written for Sirius (the strings are correct; the walkthrough still teaches upstream's feature tour)
- ⬜ Sign the Windows installer — SmartScreen warns on first run without it
- ⬜ macOS builds — packaging exists, but needs an Apple Developer certificate for notarisation
- ⬜ Deploy the update server and point `updateUrl` at it (it is `https://update.siriuside.com` today)
- ⬜ Settings UI for model providers and API keys
- ⬜ Docs site

---

## Near-term next steps (suggested order)

Distribution is in place; what is left before a first public release is the work
that needs accounts and credentials rather than code.

1. **Tag a release** — push `v0.1.0` and let the workflow build and publish. That
   exercises CI, the release assets and the update path for real.
2. **Deploy the update server** and point `updateUrl` at it.
3. **Publish `sirius-ide-bin` to the AUR** — bump `pkgver` to the release tag and
   run `updpkgsums`, which needs real assets to hash.
4. **Route edits through the chat-editing session** instead of
   `workspace.fs.writeFile`, so file writes get a diff, preview and undo.
5. **Tab / next-edit prediction** — the one Cursor feature upstream does not
   provide, and the clearest reason to choose Sirius over stock VS Code.

> Pick the next item and Sirius will implement it end to end.

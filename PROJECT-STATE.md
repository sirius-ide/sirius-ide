# Sirius IDE — Project State

**Last full audit: 2026-09-30** (against code at `f4688fa`) · released `v1.118.5` (2026-09-27; six releases `v1.118.0`…`v1.118.5`, the first with `.deb`/`.rpm`) · Arch repo still serves 1.118.4 (§12 step 6, hole 4) · shipping

This file is the single place a new session should start. It records what exists,
what is deployed, what has actually been verified, and — explicitly — what is still
open. If something here disagrees with the code, the code wins; fix this file.

Companion docs: [README.md](README.md) (what Sirius is) · [ROADMAP.md](ROADMAP.md)
(feature plan and phases) · [INSTALL.md](INSTALL.md) (how users install) ·
[PRIVACY.md](PRIVACY.md) (data posture) · [AGENTS.md](AGENTS.md) (working rules) ·
[CLAUDE.md](CLAUDE.md) (session entry point and cloud-session rules; its environment setup
script is `scripts/cloud-setup.sh`).

---

## 1. Identity

| Thing | Value |
| --- | --- |
| Product | Sirius IDE — agentic, AI-native editor; a Code - OSS (VS Code) fork |
| Positioning | Antigravity's agent-first workflows + Cursor's editing feel, multi-model, no lock-in |
| GitHub | `sirius-ide/sirius-ide` — **public**, 0 stars, `gh` authed as `iamthearsh` |
| Domains | `siriuside.com` (primary), `siriuside.dev` (redirect, unconfigured) |
| Copyright | Clicksora, L.L.C. |
| Maintainer string | `emrys <iarshrind@gmail.com>` |
| Licence | **Proprietary** (`LICENSE.txt`, `LicenseRef-Sirius`). Code - OSS and third parties keep their licences in `ThirdPartyNotices.txt` |
| Local repo | `/home/emrys/Projects/sirius` (branch `sirius`) |
| Packaging repo | `/home/emrys/Projects/aur/sirius-ide-bin` and `.../sirius-ide-git` |

Identity is not hand-edited: `node build/sirius/set-identity.mjs --owner <o> --domain <d> [--dry]`
rewrites the owner/host across `product.json`, both PKGBUILDs, the update worker and
the docs — about thirty places, which is why it exists.

---

## 2. State at a glance

| Area | Status |
| --- | --- |
| Fork + rebrand | ✅ complete (branding, icons, protocols, gallery, legal) |
| Build from source | ✅ produces `VSCode-linux-x64` (~720 MB unpacked) |
| Release CI | ✅ tag → Linux x64/arm64 + Windows x64, attested, mirrored to R2 |
| Update server | ✅ **live** at `update.siriuside.com`, serving v1.118.5 (verified 2026-09-28: a real v1.118.4 client gets 200 → 1.118.5, a 1.118.5 client gets 204) |
| Download CDN | ✅ **live** at `dl.siriuside.com` (R2, zero egress) |
| Arch pacman repo | ⚠️ **live but behind** — still serves `sirius-ide-bin 1.118.4`; v1.118.5 needs the manual rebuild (§12 step 6, hole 4) |
| AUR | ❌ not published (see §11) |
| deb / rpm | ✅ **shipped in v1.118.5** (2026-09-27) — the first ever; x64 only, arm64 is tarball-only by design (§11). Built and gated on every run since |
| macOS | ❌ not built (needs Apple Developer cert) |
| Windows signing | ❌ unsigned — SmartScreen warns |
| Website | ❌ `siriuside.com` has no DNS record at all |
| Model layer | ✅ 12 providers, keyring, native tool calling |
| Editor AI surfaces | ✅ registered as language-model vendor + tools + default agent |
| Tab completion | ✅ FIM-based, shipped |
| Next-edit prediction | ✅ shipped (default off, needs local FIM model) |
| Project rules | ✅ shipped (Phase 2 opened) |
| Working tree | see `git status`; this file lags the log |
| Unreleased | `git log --oneline v1.118.5..HEAD` — do not trust a number written here. At 2026-09-30: docs, CLAUDE.md, `scripts/cloud-setup.sh`, the state-doc refresh, and the **new icon plus its generator** — nothing under `src/` or `extensions/` changed, but the next tag ships a visibly new icon |

---

## 3. Repo layout and branch model

```
main    → clean mirror of upstream microsoft/vscode (remote: upstream)
sirius  → all Sirius work. THE ACTIVE BRANCH. Pushed to origin/sirius.
```

- Fork point: `fe0c770380f` (upstream "promptValidator: log error (#311899)").
- Sirius commits since that point: count with `git rev-list --count fe0c770380f..HEAD` on a
  full clone (cloud clones are shallow and stop short of the fork point).
- **`main` was 8034 commits behind `upstream/main` as of 2026-09-28** and the number only
  grows; recompute with `git rev-list --count main..upstream/main` where the `upstream`
  remote exists. Rebase debt is real; see §4 for where conflicts will land.

Version tags: `v1.118.0` … `v1.118.5`. Everything up to `27de2f4` ("1.118.5") is released.
Commits after it are docs, the cloud-session files and the new icon (`52d2794`, `3be0dda`);
none touch `src/` or `extensions/`. The icon is in no tag yet and ships with the next one.

### Why the version is 1.118.x

Not marketing. `package.json` `version` is the compatibility contract every
extension's `engines.vscode` is checked against. Version it `0.1.0` and
`extensionValidator.ts:isValidVersion` rejects every `^1.x` extension on Open VSX —
the editor looks fine until someone opens the marketplace. So the version tracks the
upstream base (`1.118` = VS Code 1.118 extension API) and Sirius releases move the
patch. Full reasoning in [build/update-server/VERSIONING.md](build/update-server/VERSIONING.md).

---

## 4. What Sirius changes vs upstream

About 112 files added or modified at `f4688fa` (55 added, 57 modified; 32 of them regenerated
icons under `resources/`, only 5 under `src/`), plus the whole `extensions/copilot` tree
(4,041 files) deleted. Recount with `git diff --name-status fe0c770380f HEAD`.

**Sirius-owned, no upstream conflict risk**
- `extensions/sirius-ai/` — the model layer (24 tracked files: 19 TS sources, ~5,800 lines,
  plus package/tsconfig/esbuild config)
- `extensions/theme-sirius-star/` — Sirius Star Dark
- `build/update-server/` — Cloudflare worker + docs
- `build/cloudflare/` — `deploy.sh` + token recipe
- `build/sirius/` — `set-identity.mjs`, `bootstrap-github.sh`, `abi-floor.sh` (the glibc /
  libc++ gate), `make-icons.py` (every platform icon from one source)
- `resources/sirius/` — the icon sources: `icon.png` (2048 px master) and `icon-small.png`
  (the simplified mark for 48 px and under). Every icon file under `resources/{linux,win32,
  darwin,server}` is generated from these two
- `test/harness/` — headless probe rig
- `.github/workflows/sirius-release.yml`
- `README.md`, `ROADMAP.md`, `INSTALL.md`, `PRIVACY.md`, `AGENTS.md`, this file
- `CLAUDE.md` — the tracked session entry point (cloud and local)
- `scripts/cloud-setup.sh` — the claude.ai cloud-environment setup script; keep it in sync
  with the environment's "Setup script" field
- `.claude/skills` — a symlink to the tracked `.agents/skills`; `.gitignore` keeps the rest of
  `.claude/` private

**Upstream files patched — these are the rebase conflict points**
- `product.json` — branding, `quality`/`updateUrl`/`downloadUrl`, `defaultChatAgent`, open-vsx gallery
- `build/` — `hygiene.ts`, `filters.ts`, `gulpfile.{extensions,vscode,vscode.win32,hygiene}.ts`, `lib/{copilot,extensions}.ts`, `npm/{dirs,preinstall,postinstall}.ts`, `linux/{dependencies-generator,debian/dep-lists,rpm/dep-lists}.ts` (libcups for the public Electron build; the tunnel binary made optional)
- `resources/` — icons for linux/win32/darwin/server, deb/rpm/snap packaging templates
- `LICENSE.txt`, `ThirdPartyNotices.txt`, `package.json`, `package-lock.json` (conflicts
  wholesale on every rebase — regenerate it rather than hand-merge), `eslint.config.js`, `.gitignore`
- **`src/vs/` — only 5 files.** Kept deliberately tiny:

| File | Change | Why |
| --- | --- | --- |
| `services/extensionManagement/browser/extensionEnablementService.ts` | gate the built-in-chat migration on `defaultChatAgent.entitlementUrl` | upstream keeps the chat extension dormant until a sign-in completes; Sirius has no entitlement endpoint, so it would disable `sirius-ai` **permanently on every fresh profile** |
| `contrib/extensions/browser/extensionsWorkbenchService.ts` | gate extension *unification* | unification folds a completions extension into a chat extension; when one extension is both, it disabled Sirius from itself |
| `contrib/extensions/browser/extensions.contribution.ts` | `productService.nameLong` in reload strings | told Sirius users to "reload Visual Studio Code" |
| `contrib/issue/browser/baseIssueReporterService.ts` | same | issue reporter named VS Code |
| `contrib/welcomeOnboarding/browser/onboardingVariationA.ts` | same, plus inject `IProductService` | screen readers announced "Welcome to Visual Studio Code" |

---

## 5. The `sirius-ai` extension

`extensions/sirius-ai/` — ~5,800 lines of TS. `dist/extension.js` (esbuild) for release,
`out/` (tsc) for dev watch. **No runtime dependencies** — every provider is raw
`fetch` against the vendor's HTTP API, so there is no SDK to keep current.

### Design decision that shapes everything

Upstream 1.118 already ships `chatEditing` (multi-file edits, accept/reject,
checkpoints), `inlineChat`, `agentSessions`, MCP, and a language-model tools service.
Critically, `vscode.lm.registerLanguageModelChatProvider` is **stable API** at this
fork point. So Sirius **does not build its own chat UI** — it registers into the
editor's seams and every upstream AI surface starts working against all providers at
once, and keeps improving on each rebase instead of drifting.

A bespoke 974-line chat webview *was* built and then deliberately deleted
(commit `046847ab636`, ~1,700 lines removed). Do not rebuild it.

### Module map

```
extension.ts            activation: wires everything below, status bar, commands
auth/secretStore.ts     SiriusSecretStore — keys in the OS keyring via SecretStorage,
                        auto-migrates + clears any key left in settings.json
providers/
  modelRouter.ts        provider selection, model list, thinking config, pickers
  anthropicProvider.ts  Claude — output_config.effort, prompt caching, tool_use
  geminiProvider.ts     functionDeclarations/functionResponse, thinkingConfig
  ollamaProvider.ts     local, native tool calling (prompted-tools fallback for models
                        with no tool API), large-model guard
  openaiCompatible.ts   ONE adapter → OpenAI, OpenRouter, Groq, DeepSeek, Mistral,
                        xAI, LM Studio, llama.cpp/vLLM, custom (table-driven)
lm/
  languageModelProvider.ts  registers vendor 'sirius' → editor sees every model
  toolRegistration.ts       contributes tools via vscode.lm.registerTool
chat/
  siriusAgent.ts        the product's DEFAULT chat participant (the role Copilot
                        Chat plays upstream) — ask/edit/agent modes
  projectContext.ts     project rules + ambient active-editor context
tools/toolExecutor.ts   read_file, search_files, list_directory, search_web,
                        get_diagnostics  (read-only by design — see below)
inline/
  tabCompletionProvider.ts  Tab completion: native FIM, debounced, LRU, cancellable
  fimClient.ts              FIM backend resolution (Ollama / llama.cpp)
  nextEditPredictor.ts      next-edit prediction (default off)
  inlineChatProvider.ts     registers the Tab-completion provider (37 lines); Ctrl+I
                            itself is upstream's inline chat, driven via the LM provider
importer/editorImporter.ts  import settings/extensions/recents from VS Code,
                            Cursor, Windsurf, VSCodium
scm/gitAssist.ts        fills product.json's generateCommitMessage +
                        resolveMergeConflicts hooks (buttons the workbench
                        already renders and that previously did nothing)
types.ts                shared contracts
```

**Providers: 12.** anthropic, gemini, ollama, openai, openrouter, groq, deepseek,
mistral, xai, lmstudio, llamacpp, custom. Default provider `anthropic`, default model
`claude-opus-5`.

**The mutating tools were removed from the executor** (`046847ab636`), so
`tools/toolExecutor.ts` is read-only. Editing lives in `chat/siriusAgent.ts`
(`createLocalTools`): `edit_file` (exact search/replace) and `create_file` (refuses an
existing path) apply their content through `stream.textEdit`, so the editor's diff,
checkpoint and accept/reject flow applies. `create_file` first creates the empty file with
`workspace.applyEdit`, outside the stream — see hole 9.

---

## 6. Distribution pipeline

```
git tag v1.x.y  →  .github/workflows/sirius-release.yml
                     ├─ linux x64   (ubuntu-latest)      ┐
                     ├─ linux arm64 (ubuntu-24.04-arm)   ├→ native runners, not cross-compiled
                     └─ win32 x64   (windows-2022)       ┘
                   → provenance attestation (gh attestation verify)
                   → GitHub Release  (canonical, archival)
                   → mirror to R2 bucket sirius-releases
                   → write latest-stable.json manifest to R2
                          ↓
   update.siriuside.com (Cloudflare Worker, build/update-server/worker.mjs)
     GET /api/update/{platform}/{quality}/{commit} → 204 current | 200 IUpdate
     reads the manifest from R2 (no API rate limits), GitHub as fallback
     hands back dl.siriuside.com URLs + sha256
```

**A release must contain `commit.txt`.** The editor compares commits, not versions —
without it no update is ever offered.

**Arch users** get a real pacman repo instead:
```ini
[sirius]
SigLevel = Optional
Server = https://dl.siriuside.com/arch/$arch
```

---

## 7. Live infrastructure (verified 2026-09-28)

| Endpoint | Status |
| --- | --- |
| `https://update.siriuside.com/api/update/linux-x64/stable/<commit>` | ✅ **200** → v1.118.5 for a v1.118.4 commit, **204** for the v1.118.5 commit; dl CDN URL + sha256; win32-x64 likewise |
| `https://dl.siriuside.com/releases/v1.118.5/<asset>` | ✅ **200** for both tarballs, the installer, the `.deb` and the `.rpm` |
| `https://dl.siriuside.com/arch/x86_64/sirius.db` | ✅ **200** → contains `sirius-ide-bin-1.118.4-1` |
| `https://dl.siriuside.com/` | 404 (expected — bucket root, not an index) |
| `https://siriuside.com` | ❌ **no DNS record** |
| `https://siriuside.dev` | ❌ **no DNS record** |
| GitHub releases | ✅ 6 releases, latest v1.118.5 (2026-09-27) — the first with `.deb`/`.rpm` assets |

**Cloudflare** — worker `sirius-update`, bucket `sirius-releases`, custom domains
`update.` and `dl.`. Managed by `build/cloudflare/deploy.sh` (idempotent, addresses
every resource by constant name).

**Credentials**
- Cloudflare API token → `~/.secrets/cloudflare-sirius.env` (mode 600). Never in the
  repo, never in chat. `deploy.sh` and `wrangler` both read it from there.
- CI R2 mirror → repo secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, repo
  variable `R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com` — the real
  value lives in the repo variable, not here; this repo is public). Read it back with
  `gh variable get R2_ENDPOINT`. All three configured. The mirror step is gated on the
  variable so CI stays green without it.

**Non-interference rule (standing, from `ac783951094`).** This Cloudflare account also
hosts other Clicksora projects. Zone powers are pinned to the two siriuside zones.
Account-scoped powers (Workers, R2, Pages) act on **exact names only** — `sirius-update`,
`sirius-releases`, Pages projects prefixed `sirius`. Never list-then-act, never
wildcards. No destructive call against any resource without a `sirius` name, under any
instruction including a mistaken one — flag it back instead.

---

## 8. Build and development

### The Node pin will bite you first

```
.nvmrc pins 22.22.1        system currently: node v26.8.2, npm 12.0.2
```

`build/npm/preinstall.ts` **rejects** a mismatched major, and wants npm **< 11.2.0**.
Arch ships Node 26 / npm 12. So:

```bash
nvm use                      # or otherwise put Node 22 on PATH
npm install -g npm@10        # what CI does
npm install
npm run watch                # keep running
./scripts/code.sh            # launch
```

Release build:
```bash
npm run gulp vscode-linux-x64-min     # → ../VSCode-linux-x64
```

Extension-only loop:
```bash
npm run gulp compile-extension:sirius-ai
npm run gulp watch-extension:sirius-ai
```

On the owner's machine only (cloud sessions have no build), a `../VSCode-linux-x64` built on
2026-08-26 exists. It predates the 2026-09-27 `sirius-ai` changes (prompted tools, images to
every model, the integrated browser on by default), so rebuild before probing against it.
Cloud sessions: setup is `scripts/cloud-setup.sh`; the probe rig needs a built app and local
models, so it is normally local-only.

### Headless verification rig

```bash
test/harness/run.sh <app-dir> <probe.js> <result.json> [wait-iterations of 2 s; default 90]
```
Injects a probe extension into a built app, runs it under Xvfb against a fresh
profile with `--use-inmemory-secretstorage`, and returns JSON. Existing probes in
`test/harness/probes/`:

| Probe | Proves | Needs |
| --- | --- | --- |
| `agent-tools.js` | runtime tool inventory (29 → 38 with the browser gate), tool tiers, image API | local Ollama models |
| `flagged-bugs.js` | `product.json` wiring: `sirius.ai.debug.extensionState` runs, `sirius.ai.enable` default, no image-gen models in chat | built app only |
| `import-from-vscode.js` | settings/keybindings/snippets import | a real `~/.config/Code` |
| `project-rules.js` | `.siriusrules` + `AGENTS.md` loader order | built app only |
| `prompted-tools.js` | prompted tool envelope on a no-tools model, via `selectChatModels` + `sendRequest` | local Ollama |

**Use this to verify editor-integration claims** rather than reasoning about them — it is
how the language-model bridge and the agent tool loop were actually confirmed.

---

## 9. Verification status — what is actually proven

Be precise about this; several things are wired but never exercised live.

| Claim | Evidence |
| --- | --- |
| Branded app builds and launches | ✅ built, launched, `sirius.sirius-ai` activates with no ext-host errors, theme registers |
| LM bridge works | ✅ probed from outside: `vscode.lm.selectChatModels({vendor:'sirius'})` returns models, `sendRequest` streams |
| Native tool calling, multi-round | ✅ verified end to end against a local Ollama model |
| OpenAI-compatible adapter | ✅ verified against local Ollama's OpenAI endpoint |
| Anthropic request shape | ⚠️ corrected against the documented API; **not confirmed against a live paid key** |
| Gemini tool calling | ⚠️ wire format verified by stub; **never exercised against the live API** |
| Update protocol | ✅ live endpoint returns a well-formed `IUpdate` |
| Windows installer | ⚠️ builds and uploads; **never installed and run by anyone** |
| deb / rpm (x64) | ✅ **produced and gated on CI** (rehearsal 36335699671): sysroot toolchain, hard ABI floor (glibc ≤ 2.28, no libstdc++ DT_NEEDED across 16 binaries), dlopen smoke, byte-exact dep-list match, Packaging gate green |
| The **published** v1.118.5 `.deb` / `.rpm` | ✅ inspected from the CDN (ranged fetch of the control/header sections): deb `Depends` floors at `libc6 (>= 2.28)`, `libcups2` present, **no `libstdc++6`**; `postrm` executable lines carry no Microsoft/apt-repo reference; rpm `GLIBC_2.28` max, `libcups` in, no `libstdc++`, Vendor `Clicksora, L.L.C.` |
| Release provenance | ✅ `gh attestation verify commit.txt --owner sirius-ide` exit 0 (Sigstore bundle, cert issued at release time). It prints nothing on success outside a TTY — check the exit code |
| deb / rpm installed on Debian 12 / Ubuntu 22.04 / RHEL 9 | ⚠️ **not yet** — the floor is proven by the gate; an install in a container is the remaining step |
| Image input to models | ⚠️ wire format proven for all 4 providers by probe; **no vision model exercised live** (`ollama pull moondream` would close it) |
| Integrated browser tools | ✅ 38 tools on a fresh profile, all seven browser ids present (`test/harness/probes/agent-tools.js`) |
| Tiered / size-aware native tools | ✅ probe-proven: 1.5B → core, ≥ 6 GB → extended |
| Prompted tools on a no-tools model | ✅ probe-proven end to end (`test/harness/probes/prompted-tools.js`): real tool call in 2.6 s, streamed answer in 197 parts |
| macOS | ❌ never built |

---

## 10. Open holes

Ordered by how much they hurt. Last audited against code on 2026-09-30 (`f4688fa`); delete an
item as soon as it is resolved rather than leaving it here.

### Blocking users right now

1. **`.deb` and `.rpm` exist for x64 only.** Five releases shipped neither; the
   chain is fixed, gated on CI, and shipped in v1.118.5 (§11 records the four defects that
   were stacked behind the obvious one). What remains open is arm64: its packages need
   the glibc-2.28 sysroot, whose aarch64 compilers are x86_64 binaries that cannot run
   on the native arm64 runner, so arm64 is tarball-only until an upstream-style
   cross-build on an x64 runner is set up and rehearsed. INSTALL.md says so.

2. **No website.** `siriuside.com` and `siriuside.dev` have no DNS records. Every
   user-facing URL in `product.json` points at GitHub instead. The Cloudflare token
   already carries Pages permissions for exactly this.

3. **AUR not published.** `sirius-ide-bin` and `sirius-ide-git` PKGBUILDs are ready and
   correct (identity already rewritten to `sirius-ide/sirius-ide`), but nothing is on
   the AUR. Blocked on AUR account registration, which was paused during their
   malicious-packages incident — **re-check whether it has reopened**. The pacman repo
   is the first-class path either way, so this is reach, not function.

### Operational

4. **Arch repo publishing is entirely manual.** Nothing in the repo builds
   `sirius.db` or uploads it. Packages are built by hand in
   `~/Projects/aur/sirius-ide-bin` (which holds ~2.3 GB of tarballs and `.pkg.tar.zst`
   for 1.118.0–1.118.4) and pushed to R2 ad hoc. **This is the biggest automation gap
   in the release train** — every release needs a human to remember it, and there is no
   script recording how it was done. Write one.

5. **The Arch repo lags every release until someone runs the manual rebuild.** The
   update server advertised v1.118.5 within minutes of the tag; `sirius-ide-bin` on
   `dl.siriuside.com/arch` still says 1.118.4 until §12 step 6 is done by hand. Hole 4 is
   the cure; until then this reopens on every tag.

6. **Dependabot "devcontainers" runs were flaky** — failed 2026-08-31, 09-07 and 09-14,
   then succeeded 09-21 and 09-28. Watch one more weekly cycle and delete this if it stays
   green. Separately, **five open Dependabot GitHub-Actions bump PRs (#1–#5, opened
   2026-09-27) are untriaged**: checkout v4→7, cache v5→6, download-artifact v4→8,
   setup-python v6→7, action-gh-release v2→3. Four of them change actions pinned in
   `sirius-release.yml`, so rehearse with a branch dispatch (Publish gated off) before
   merging any of them.

7. **Windows installer unsigned** — SmartScreen warns on first run. Needs a code
   signing certificate.

8. **macOS unbuilt** — packaging exists; needs an Apple Developer certificate for
   notarisation, without which Gatekeeper refuses the app.

### Product

9. **`create_file` creates the empty file outside the edit stream.** Edits themselves go
   through the chat-editing session (`stream.textEdit` in `chat/siriusAgent.ts`, since
   `cf02d47c535`), so diff, checkpoint and accept/reject apply. But `create_file` first
   calls `workspace.applyEdit(createFile)` and only streams the content, so the creation
   itself may sit outside the session's diff/undo. Unverified live; small.

10. **Onboarding walkthrough** still teaches upstream's feature tour (strings are
    branded correctly; content is not ours).

11. **No dedicated settings page for AI providers or API keys.** Provider, model,
    endpoints, thinking and completion options are ordinary settings under "Sirius AI".
    API keys are set only through `Sirius: Set API Key`, by design (they live in the
    keyring; the old `apiKey` settings are deprecated and auto-migrated).

12. **Gemini and Anthropic never exercised live** (see §9). A single real request each
    would close it.

13. **Remote development points at a server that is never built.** `product.json`
    sets `serverDownloadUrlTemplate` to `sirius-server-${os}-${arch}.tar.gz` on the
    release, but no job in `sirius-release.yml` builds the REH server, so Open
    Remote-SSH (and any remote extension that reads the template) 404s. Nothing in
    `src/vs` reads the key — only third-party remote extensions do. The fix is a
    `vscode-reh-linux-${arch}-min` job producing that exact asset name (~15 min per
    arch; the tunnel CLI is not required for REH). Until then the template is an
    honest pointer to a missing file, and removing it would only change the failure
    from a 404 to "no download URL".

### Structural

14. **Rebase debt: `main` is 8034 commits behind `upstream/main`.** The longer this
    runs the harder the `src/vs` patches and `build/` changes get. See §4 for exactly
    which files carry conflict risk — deliberately only 5 under `src/vs`.

---

## 11. Gotchas worth not rediscovering

Each of these cost real time.

- **The workbench's own tools are far richer than this file once claimed.** An earlier
  audit recorded "only two of its own". The runtime probe
  (`test/harness/probes/agent-tools.js`) shows **29** native tools in `vscode.lm.tools`
  on a fresh profile — terminal, tasks, todo list, plan review, subagents, tests — and
  **38** once `workbench.browser.enableChatTools` opens the Playwright integrated-browser
  family (`read_page`, `screenshot_page`, `click_element`, …). Sirius turns that gate
  on via `sirius-ai`'s `contributes.configurationDefaults`; `product.json` cannot carry
  it (`IProductConfiguration` has no such field). What extensions *cannot* reach: the
  edit tool and `setArtifacts`, which are core-agents-only. That gap is why
  `lm/toolRegistration.ts` supplies read/search tools and the agent applies edits itself
  through `stream.textEdit`. The agent offers natives in two tiers
  (`chat/siriusAgent.ts`), sized by on-disk bytes for local models, so a 1.5B is not
  handed sixteen schemas.
- **Two Copilot-shaped mechanisms silently disabled `sirius-ai`** — the built-in chat
  enablement migration (waits for a sign-in that never comes) and extension
  unification (folded the extension into itself). Both now check whether they apply.
  Symptom was a dead "Auto" in the model picker and no models at all.
- **The editor resolves "Auto" against models registered at that instant.** On a fresh
  window a request can beat discovery and fail with "Language model unavailable" — so
  activation warms the registry with a throwaway `selectChatModels` call.
- **Anthropic effort is `output_config.effort`, not `thinking.effort`,** and some
  models reject sampling parameters outright.
- **Gemini's field is `thinkingConfig`, not `generationConfig.thinking`,** and without
  `includeThoughts` thought parts are never returned at all.
- **Prompt caching on the system prompt** is not just cheaper — cached reads do not
  count toward the input-tokens-per-minute limit.
- **`quality: "stable"` switches on Microsoft-internal packaging paths.** Getting
  Windows through them took five tag cuts to reach v1.118.0. If Windows packaging
  breaks after a rebase, start there.
- **`windows-latest` carries VS 18, which node-gyp 11 cannot classify** ("unknown
  version undefined") — native modules fail to configure. CI is pinned to
  `windows-2022` on purpose. Do not "modernise" it.
- **`vscode-win32-x64-inno-updater` must run between build and installer** —
  `code.iss` line 108 requires the staged updater binaries unconditionally.
- **arm64 must build on an arm64 runner.** Cross-compiling on x64 builds Electron's
  native modules for the wrong host and fails late and confusingly.
- **arm64 therefore ships a tarball ONLY — no `.deb`, no `.rpm`.** Installable Linux
  packages require the glibc-2.28 sysroot, and its aarch64 toolchain is a Canadian
  cross whose compilers are *x86_64* ELF binaries — they cannot execute on
  `ubuntu-24.04-arm` at all. A native arm64 build floors at the runner's glibc 2.38
  and GLIBCXX_3.4.31, over every cap in the aarch64 reference dep-lists, and apt/dnf
  on Debian 12, Ubuntu 22.04 and RHEL/Rocky 9 correctly refuse such a package. Do NOT
  "finish the matrix" by setting `FAIL_BUILD_FOR_NEW_DEPENDENCIES = false` or by
  regenerating the lists from a runner build: a package that will not install is
  worse than a missing one. The only route to arm64 packages is upstream's
  sysroot cross-build on an x64 runner, which is a separate, separately-rehearsed
  change.
- **x64 packages only install because `build/azure-pipelines/linux/setup-env.sh` is
  sourced in the SAME `run:` block as `npm ci`.** GitHub Actions gives every step a
  fresh shell and the script only *exports* CC/CXX/CXXFLAGS/LDFLAGS. Split them and
  `npm ci` silently falls back to the runner's gcc; nothing fails until prepare-deb,
  two steps later, with "The dependencies list has changed". `build/` must also be
  `npm ci`'d BEFORE that step — `libcxx-fetcher.ts` imports `@electron/get` from
  `build/node_modules`, which the root postinstall only creates afterwards.
- **Sirius ships the public Electron, upstream's reference dep-lists assume
  Microsoft's.** `product.json` has no `electronRepository`, so the binary links
  `libcups.so.2`; the amd64/x86_64 lists had no cups entry. Every Electron bump can
  surface another such delta — the "Old:/New:" diff `prepare-deb` prints is the
  designed diagnostic, not a wall to route around.
- **`resources/linux/debian/postrm.template` used to delete Microsoft's apt source and
  signing key on uninstall.** Upstream's teardown keyed on a debconf question Sirius no
  longer declares, so `RET` kept its literal `true` and the removal ran unconditionally
  — breaking updates for a real VS Code installed beside Sirius. Latent only because no
  `.deb` had ever shipped; fixed before the first one does.
- **Three `product.json` `defaultChatAgent` keys looked equally dead and were not.**
  `completionsEnablementSetting` (`sirius.ai.enable`) is read by the chat status
  dashboard as a per-language object (`editor/common/services/completionsEnablement.ts`:
  explicit language wins, `*` falls back, non-object means off) — it had to be declared
  and honoured by the Tab completion provider, or the dashboard's toggle wrote to a key
  nothing read. `chatExtensionOutputExtensionStateCommand`
  (`sirius.ai.debug.extensionState`) is executed before "Show Chat Extension Output",
  and `chatExtensionOutputId` names an output channel that must actually exist — it is
  "Sirius AI", so the agent's channel was renamed to match. `completionsAdvancedSetting`
  (`sirius.ai.advanced`) is deliberately NOT declared: the workbench registers its
  schema itself inside the Copilot sign-in path Sirius never enters, and declaring an
  unread setting would be a promise of its own.
- **The platform icons are generated — do not hand-edit them.** `resources/linux/code.png`,
  the Windows ICO, tiles and Inno bitmaps, the macOS ICNS and the server favicon/PWA PNGs
  all come from `python3 build/sirius/make-icons.py resources/sirius/icon.png --small
  resources/sirius/icon-small.png --installer`. Detailed art stops reading below ~48 px
  (a lens flare becomes a stray dot), which is why there are two sources. ImageMagick's
  ICNS writer here emits a bare PNG and Pillow's omits the non-retina small entries, so
  the script packs the ICNS container itself.
- **The old deb `postinst` installed Microsoft's apt repository and signing key onto
  the user's machine.** Removed. Do not let a rebase bring it back.
- **Four Windows AppIds contained non-hex characters** and would have broken the Inno
  Setup installer. Regenerated.
- **`extensions/copilot.disabled/`** is a gitignored on-disk backup of the removed
  upstream extension. It must never leak into a package.
- **The release tarball unpacks to `VSCode-linux-<arch>/`** — upstream's directory
  name, not worth renaming; both PKGBUILDs depend on it.

---

## 12. Release checklist

```bash
# 0. Node 22 on PATH, npm 10
nvm use && npm install -g npm@10

# 1. Rehearse first: `gh workflow run sirius-release.yml --ref sirius` runs the
#    whole build on the tag candidate with Publish skipped (branch dispatch fails
#    the `github.ref_type == 'tag'` gate). Read the Packaging gate summary.
# 2. Bump — exactly three lines, by hand, never `npm install` (that rewrote the
#    whole lock once): package.json:3, package-lock.json:3, package-lock.json:9.
#    Commit subject is the bare version, as every prior bump (d4ad0d51114).
#    <X.Y.Z> below is the NEW version (v1.118.5 is already tagged; next is 1.118.6).
git commit -m "<X.Y.Z>"
# 3. Push the branch first (silent — nothing triggers on a branch push), then an
#    ANNOTATED tag pushed BY NAME. All shipped tags are annotated; `--tags` would
#    push every stray local tag.
git push origin sirius
git tag -a v<X.Y.Z> -m "Sirius IDE <X.Y.Z>"
git push origin v<X.Y.Z>      # <- this is the ship

# 4. CI builds linux x64/arm64 + win32, attests, releases, mirrors to R2,
#    writes latest-stable.json. Watch it:
gh run watch --repo sirius-ide/sirius-ide
#    Green is not proof of packages, but RED for packaging is now a real failure:
#    the "Packaging gate" fails the linux job and Publish is skipped by design.
#    Read the step summary. If you have decided to ship without deb/rpm anyway,
#    dispatch against the TAG (a branch dispatch is skipped by the Publish gate;
#    "Re-run failed jobs" replays the push event with no inputs):
#    gh workflow run sirius-release.yml --ref v<X.Y.Z> -f allow_missing_packages=true

# 5. Confirm the update server sees it
curl https://update.siriuside.com/api/update/linux-x64/stable/0000000000000000000000000000000000000000

# 6. MANUAL, not yet scripted — Arch repo:
#    build sirius-ide-bin in ~/Projects/aur/sirius-ide-bin
#    (bump pkgver, updpkgsums, makepkg --printsrcinfo > .SRCINFO, makepkg)
#    then repo-add sirius.db.tar.gz <pkg> and upload db + pkg to
#    s3://sirius-releases/arch/x86_64/  (see hole #4 — automate this)
```

Verify provenance of any asset: `gh attestation verify <file> --owner sirius-ide`.

---

## 13. If you are a new session, start here

**Last handoff (2026-09-30, cloud session, branch `claude/stoic-faraday-wrxkp9`).** Docs
only, no product code: this file, ROADMAP.md, README.md and CLAUDE.md were audited against
the code at `f4688fa` and the confirmed drift fixed (release header and §3, hole 9 rewritten,
probe table, patched-file list, README's Arch install, the icon item). Nothing here needs
local verification. Next to tackle, in order: automate the Arch repo (hole 4), prove the
`.deb`/`.rpm` install in containers, the REH server job, and triage the five Dependabot PRs
— all doable from a cloud session as CI changes rehearsed with a branch dispatch. The live
Anthropic/Gemini/vision runs stay local-only.

1. `git log --oneline -20` — this file can lag; the log cannot.
2. `git status` and `git log origin/sirius..HEAD` — is there unpushed or unreleased work?
3. Read §10 (open holes) and pick from the top.
4. Before claiming any editor-integration works, prove it with `test/harness/run.sh`.
5. Node 22 or nothing (§8).

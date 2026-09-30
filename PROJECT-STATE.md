# Sirius IDE — Project State

**Last full audit: 2026-09-30** (against code at `10f1cc8d`) · released `v1.118.6` (2026-09-30; seven releases `v1.118.0`…`v1.118.6`) · the release train ships the REH server, proves the `.deb`/`.rpm` install in Debian 12 / Ubuntu 22.04 / Rocky 9, and publishes the Arch repo itself — all first run for real on the v1.118.6 tag and verified from the outside (§13) · shipping

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
| Release CI | ✅ tag → Linux x64/arm64 + Windows x64, attested, mirrored to R2. **On branch `claude/busy-davinci-2vct4i` (not yet on `sirius`): arm64 is cross-compiled on the x64 runner through the glibc-2.28 sysroot and gets `.deb`/`.rpm`** — rehearsal 36788412045 green |
| Update server | ✅ **live** at `update.siriuside.com`, serving v1.118.6 (verified 2026-09-30 after deploying worker version `b8394745`: an old linux-x64 / linux-arm64 / win32-x64 client gets 200 → 1.118.6 with its own asset and the sha256 from that asset's `.sha256`; a 1.118.6 client gets 204) |
| Download CDN | ✅ **live** at `dl.siriuside.com` (R2, zero egress) |
| Arch pacman repo | ✅ **automated and live** — every stable tag builds `sirius-ide-bin` from its own tarball, installs it on Arch, and publishes it to `dl.siriuside.com/arch/x86_64` (jobs `arch` + `arch-publish`). First real publish on v1.118.6 (run 36773757646): `sirius.db` lists `sirius-ide-bin-1.118.6-1` |
| AUR | ❌ not published (see §11) |
| deb / rpm | ✅ **shipped since v1.118.5** (2026-09-27, the first ever), x64. Built and gated on every run since, and **installed and run in Debian 12 / Ubuntu 22.04 / Rocky 9 containers on every run** (job `install-test`, required by Publish). **arm64 `.deb`/`.rpm`: built, gated and installed the same way on branch `claude/busy-davinci-2vct4i` (rehearsal 36788412045); they ship with the first tag after the cherry-pick** |
| REH server | ✅ **shipped in v1.118.6** — `sirius-server-linux-{x64,arm64}.tar.gz`, the asset `serverDownloadUrlTemplate` promised since v1.118.0; x64 gated at glibc 2.28 / GLIBCXX 3.4.25 and started in the containers. Both template URLs answer 200. On branch `claude/busy-davinci-2vct4i` the arm64 server has the same 2.28 / 3.4.25 floor and is started in the arm64 containers too |
| macOS | ❌ not built (needs Apple Developer cert) |
| Windows signing | ❌ unsigned — SmartScreen warns |
| Website | ❌ `siriuside.com` has no DNS record at all |
| Model layer | ✅ 12 providers, keyring, native tool calling |
| Editor AI surfaces | ✅ registered as language-model vendor + tools + default agent |
| Tab completion | ✅ FIM-based, shipped |
| Next-edit prediction | ✅ shipped (default off, needs local FIM model) |
| Project rules | ✅ shipped (Phase 2 opened) |
| Working tree | see `git status`; this file lags the log |
| Unreleased | `git log --oneline v1.118.6..HEAD` — do not trust a number written here. At 2026-09-30: the update-worker fix (`db3e2b6`, already deployed — the worker ships separately from releases) and this state-doc update |

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

Version tags: `v1.118.0` … `v1.118.6`. Everything up to `b8a169d` ("1.118.6") is released.
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
  libc++ gate, client and server layouts), `make-icons.py` (every platform icon from one
  source), `install-test.sh` (the container install proof), `publish-arch-repo.sh` (the
  pacman repository update)
- `build/arch/` — `sirius-ide-bin/PKGBUILD` with its desktop and mime files, and `build.sh`,
  which builds, installs and runs the package inside an Arch container
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
                     ├─ linux x64   (ubuntu-22.04)        ┐ tarball + REH server + .deb/.rpm, both on
                     ├─ linux arm64 (ubuntu-22.04, cross) ├→ x64 runners — arm64 through the aarch64
                     └─ win32 x64   (windows-2022)        ┘ glibc-2.28 sysroot; win32: installer
                     ├─ install-test: the .deb/.rpm/tarball + server in debian:12, ubuntu:22.04,
                     │                rockylinux:9 containers, x64 AND arm64 — 7 legs, all required
                     └─ arch: sirius-ide-bin built from the run's tarball, installed, run
                   → Publish (tag only; needs linux + install-test + arch green)
                       provenance attestation (gh attestation verify)
                       GitHub Release via gh (canonical, archival)
                       mirror to R2 bucket sirius-releases
                       write latest-stable.json manifest to R2
                   → arch-publish (stable tags only): repo-add + upload to R2 arch/x86_64,
                       verified through dl.siriuside.com; --dry-run on a branch
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
| `https://update.siriuside.com/api/update/<platform>/stable/<commit>` | ✅ **200** → v1.118.6 for an older commit, **204** for the v1.118.6 commit, on linux-x64, linux-arm64 and win32-x64 (verified 2026-09-30); dl CDN URL + a sha256 matching the asset's own `.sha256` |
| `https://dl.siriuside.com/releases/v1.118.6/<asset>` | ✅ **200** for all 15 v1.118.6 assets (tarballs, server tarballs, installer, `.deb`, `.rpm`, Arch package, checksums), each the same size as on GitHub |
| `https://dl.siriuside.com/arch/x86_64/sirius.db` | ✅ **200** → contains `sirius-ide-bin-1.118.4-1` |
| `https://dl.siriuside.com/` | 404 (expected — bucket root, not an index) |
| `https://siriuside.com` | ❌ **no DNS record** |
| `https://siriuside.dev` | ❌ **no DNS record** |
| GitHub releases | ✅ 7 releases, latest v1.118.6 (2026-09-30) — 15 assets, the first with the REH server and the Arch package |

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
| deb / rpm installed on Debian 12 / Ubuntu 22.04 / Rocky 9 | ✅ **CI, every run** (run 36762589539): apt/dnf resolve the generated dependency lists from the distros' own repos, `sirius --version` reports the release commit, all 12 shipped binaries resolve every library, the editor stays up under Xvfb for 60 s with `window1/renderer.log` written, and the server starts and answers `/version`. Since branch `claude/busy-davinci-2vct4i` every leg also dlopens every native module under the shipped Electron and the server's under its node (`build/sirius/dlopen-smoke.cjs`) |
| deb / rpm / tarball (arm64) | ✅ **branch `claude/busy-davinci-2vct4i`, rehearsal 36788412045**: cross-compiled on the x64 runner (sysroot aarch64 gcc 10.5 for the client, gcc 8.5 for remote/), ABI floor glibc ≤ 2.28 / GLIBCXX ≤ 3.4.26, every ELF in both trees checked for machine type (`build/sirius/elf-arch.sh`), byte-exact dep-list match, then **installed and run on arm64 hardware**: `.deb` on Debian 12 and Ubuntu 22.04, `.rpm` on Rocky 9, tarball on Debian 12 — the leg that was red for v1.118.6. Not yet on `sirius`, not yet in a release |
| REH server x64 | ✅ built and gated on CI: 9 server binaries at glibc ≤ 2.28, GLIBCXX ≤ 3.4.25 (the floor `check-requirements.sh` promises); nodejs.org's Node 22.22.1 verified against `build/checksums/nodejs.txt`; `sirius-server --version` and `/version` proven in all three containers. **Not yet exercised by a real remote extension** (Open Remote - SSH from a client): local-only proof |
| REH server arm64 | ✅ on branch `claude/busy-davinci-2vct4i` (rehearsal 36788412045): gated at glibc ≤ 2.28 / GLIBCXX ≤ 3.4.25 like x64, modules dlopen under its node, started and `/version` answered in all four arm64 containers. **v1.118.6's published arm64 server still has the native runner's glibc 2.38 floor** until the next tag |
| arm64 tarball on Debian 12 arm64 | ✅ on branch `claude/busy-davinci-2vct4i` (rehearsal 36788412045): installs its dependency set, every binary resolves, every module dlopens, the window comes up. **v1.118.6's published tarball still does not run there** (measured in run 36762589539: GLIBC_2.38 / GLIBCXX_3.4.31 from the native build); the next tag replaces it |
| Arch package | ✅ CI, every run: built with makepkg in `archlinux:base-devel`, `pacman -U` resolves every declared dependency, `sirius --version` correct, 11+ binaries link, desktop files validate; `repo-add` rehearsed on the runner. **The R2 upload itself runs only on a tag** and has not run yet |
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

1. **Closed on branch `claude/busy-davinci-2vct4i` (2026-09-30), pending the cherry-pick and the
   next tag — `.deb` and `.rpm` existed for x64 only.** arm64 is now cross-compiled on
   the x64 runner through upstream's aarch64 glibc-2.28 sysroot, and gets the packages,
   a tarball and a server with the same floor as x64 — installed and run on arm64
   hardware in Debian 12, Ubuntu 22.04 and Rocky 9 containers on every run (rehearsal
   36788412045; §9, §11). Until the tag lands, v1.118.6's arm64 tarball and server keep the
   native build's glibc 2.38 floor and do not run on Debian 12 arm64. Delete this item
   once the tag is out.

2. **No website.** `siriuside.com` and `siriuside.dev` have no DNS records. Every
   user-facing URL in `product.json` points at GitHub instead. The Cloudflare token
   already carries Pages permissions for exactly this.

3. **AUR not published.** `sirius-ide-bin` and `sirius-ide-git` PKGBUILDs are ready and
   correct (identity already rewritten to `sirius-ide/sirius-ide`), but nothing is on
   the AUR. Blocked on AUR account registration, which was paused during their
   malicious-packages incident — **re-check whether it has reopened**. The pacman repo
   is the first-class path either way, so this is reach, not function.

### Operational

4. **Closed 2026-09-30 — the Arch repository publishes itself.** v1.118.6's tag run
   (36773757646) ran `arch-publish` for the first time: `sirius.db` on
   `dl.siriuside.com/arch/x86_64` lists `sirius-ide-bin-1.118.6-1` and the script verified
   the package bytes through the CDN. Arch users moved 1.118.4 → 1.118.6 (1.118.5 was never
   rebuilt for them). The owner's `~/Projects/aur/sirius-ide-bin` is history: the PKGBUILD
   lives in `build/arch/`. One hardening item is open — see §13.

5. **Dependabot "devcontainers" runs were flaky** — failed 2026-08-31, 09-07 and 09-14,
   then succeeded 09-21 and 09-28. Watch one more weekly cycle and delete this if it stays
   green. The five GitHub-Actions bump PRs (#1–#5) are triaged: the majors are applied
   to `sirius-release.yml` on `sirius` (checkout v7, setup-node v6, cache v6,
   upload-artifact v7, download-artifact v8; `softprops/action-gh-release` is gone —
   Publish uses the runner's `gh`). The PRs themselves touch 16 upstream-inherited
   workflows (`pr.yml`, `chat-perf.yml`, …) that this fork keeps identical to
   `microsoft/vscode`, so #1–#4 were **closed, not merged** (2026-09-30); #5 is moot — the
   action is gone — and is left for Dependabot to close. Dependabot's default 5-open-PR limit means more bumps are
   queued behind these, and every future one will touch upstream workflows too — that is
   the price of keeping `.github/dependabot.yml` (an upstream file) enabled.

6. **Windows installer unsigned** — SmartScreen warns on first run. Needs a code
   signing certificate.

7. **macOS unbuilt** — packaging exists; needs an Apple Developer certificate for
   notarisation, without which Gatekeeper refuses the app.

### Product

8. **`create_file` creates the empty file outside the edit stream.** Edits themselves go
   through the chat-editing session (`stream.textEdit` in `chat/siriusAgent.ts`, since
   `cf02d47c535`), so diff, checkpoint and accept/reject apply. But `create_file` first
   calls `workspace.applyEdit(createFile)` and only streams the content, so the creation
   itself may sit outside the session's diff/undo. Unverified live; small.

9. **Onboarding walkthrough** still teaches upstream's feature tour (strings are
   branded correctly; content is not ours).

10. **No dedicated settings page for AI providers or API keys.** Provider, model,
    endpoints, thinking and completion options are ordinary settings under "Sirius AI".
    API keys are set only through `Sirius: Set API Key`, by design (they live in the
    keyring; the old `apiKey` settings are deprecated and auto-migrated).

11. **Gemini and Anthropic never exercised live** (see §9). A single real request each
    would close it.

12. **The REH server has not been used through a real remote extension.** It builds,
    gates, starts and answers `/version` in three distros' containers (§9), and
    `serverDownloadUrlTemplate` resolves — 200 for x64 and arm64 since v1.118.6. Connecting
    with Open Remote - SSH from a Sirius client to a host that installs it is the
    remaining proof, and needs a machine with SSH — local-only.

### Structural

13. **Rebase debt: `main` is 8034 commits behind `upstream/main`.** The longer this
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
- **arm64 is cross-compiled on the x64 runner, and it takes THREE things together.**
  `npm_config_arch=arm64` AND the sysroot toolchain sourced in the same shell AND
  `node build/npm/preinstall.ts` run by hand before `npm ci`. The first cross attempt
  (before `c87ef00`) set `npm_config_arch` alone, so the runner's own gcc emitted x86_64
  modules into an arm64 Electron and nothing noticed until the app ran; the native-runner
  detour that followed could never produce packages — the sysroot's aarch64 compilers are
  x86_64 binaries — and floored at glibc 2.38, which no supported distro has. Do NOT go
  back to `ubuntu-24.04-arm` for the build, and do NOT "finish the matrix" by setting
  `FAIL_BUILD_FOR_NEW_DEPENDENCIES = false` or regenerating the lists from a runner
  build. The preinstall run matters because npm 10 runs the root `preinstall` only after
  the whole tree is reified: the V8 `<source_location>` header patch it applies would
  land after node-gyp compiled everything, and `native-keymap` does not compile against
  the unpatched header with the sysroot's gcc 10.5 (x64 never noticed — Chromium's libc++
  has the header). Upstream's pipeline runs it by hand for the same reason.
- **`VSCODE_ARCH` must be job-level in the linux job, not exported in one shell.** The
  microsoft-authentication extension's esbuild copies the MSAL runtime for
  `VSCODE_ARCH || process.arch` (Linux x64 only) while Build and Build server bundle the
  extensions; without it the arm64 tarball, packages and server carried x86-64 `.node`
  and `.so` files that no dependency list mentions. `build/sirius/elf-arch.sh` now checks
  every ELF in both trees for the matrix architecture — it exists because of this.
- **The x64 runner cannot execute what it builds for arm64, so the runtime proof lives in
  `install-test`.** The dlopen smoke is `build/sirius/dlopen-smoke.cjs`, run by the linux
  job only where the runner's architecture is the build's and by every install-test leg on
  the installed tree (client under the shipped Electron, server under its node). Note that
  `ldd` accepts a binary of the wrong architecture — it prints "not a dynamic executable"
  and exits 1, which `| grep 'not found'` waved through — so `install-test.sh` checks its
  exit status. The three checks in the linux job (two ABI floors, ELF architecture) run
  with `continue-on-error` and become the verdict in the Packaging gate, so one rehearsal
  returns every diagnostic instead of stopping at the first.
- **The arm64/aarch64 reference dep-lists differ from upstream's by more than cups.**
  aarch64 rpm: `+libcups.so.2`, `−libc.so.6(GLIBC_2.27)` (tunnel-only, like x86_64),
  `GCC_4.2.0` STAYS (on aarch64 it is a soft-float helper Electron and the watcher import,
  not the Rust unwinder it was on x86_64), `GCC_4.5.0` is spdlog's long double. arm64 deb:
  `+libcups2 (>= 1.6.0)`, `−libstdc++6 (>= 5)` (only upstream's distro-mixed vsda.node
  produced that floor; Sirius does not ship it). A review cross-compiled all eleven modules
  to predict these before the first rehearsal; the first rehearsal (36786333471) matched the aarch64 rpm list byte for byte and the arm64 deb list except one libstdc++6 floor — the build generates `(>= 5)`, not `(>= 5.2)`, the reverse of that prediction — and the second (36788412045) matched both.
- **Linux packages only install because `build/azure-pipelines/linux/setup-env.sh` is
  sourced in the SAME `run:` block as `npm ci`.** GitHub Actions gives every step a
  fresh shell and the script only *exports* CC/CXX/CXXFLAGS/LDFLAGS. Split them and
  `npm ci` silently falls back to the runner's gcc; nothing fails until prepare-deb,
  two steps later, with "The dependencies list has changed". `build/` must also be
  `npm ci`'d BEFORE that step — `libcxx-fetcher.ts` imports `@electron/get` from
  `build/node_modules`, which the root postinstall only creates afterwards.
- **Sirius ships the public Electron, upstream's reference dep-lists assume
  Microsoft's.** `product.json` has no `electronRepository`, so the binary links
  `libcups.so.2`; none of upstream's lists had a cups entry. Every Electron bump can
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
  name, not worth renaming; the PKGBUILD depends on it.
- **`minify-vscode-reh` is dead in this tree.** `build/buildConfig.ts` sets
  `useEsbuildTranspile = true`, so `vscode-linux-<arch>-min` bundles straight from `src/`
  and leaves no transpiled `out-build/*.js` for the legacy gulp-tsb server bundle to read.
  The server is bundled the way upstream's `core-ci` does it —
  `node build/next/index.ts bundle --target server --out out-vscode-reh-min --minify
  --mangle-privates --nls` — then packaged with `vscode-reh-linux-<arch>-min-ci`.
  A review caught this before the first rehearsal; the legacy task would have failed both
  Linux legs.
- **`FATAL: ... Failed to shutdown` from Electron is the SIGTERM, not a crash.** When
  `timeout(1)` ends the install test's 60 s grace period, Electron logs exactly that line
  on the way out. The crash grep in `install-test.sh` excludes it; the first rehearsal
  went red on every leg because it did not.
- **git 2.34 (ubuntu:22.04) does not reliably include root files in a cone-mode sparse
  checkout.** `package.json` went missing in that container only. The install-test job
  uses non-cone patterns (`/package.json`, `/build/sirius/`).
- **Ubuntu's `pacman-package-manager` needs `libarchive-tools` to read a zstd package.**
  Without `bsdtar`, `repo-add` reports every `.pkg.tar.zst` as "not a package file".
- **makepkg does not download a source whose file is already under the PKGBUILD.** For a
  `name::url` source it looks for `name` in `$startdir` (and `SRCDEST`) first. That is
  how the Arch package is built from the run's own tarball before the GitHub release the
  URL names exists, and `updpkgsums` fills the real checksums from the same file.
- **The pacman package object is immutable by name.** `publish-arch-repo.sh` uploads it
  with a one-year immutable cache and a `sha256` metadata field, and refuses to overwrite
  different bytes under the same name — republishing a version needs a higher `pkgrel`
  (the workflow's `arch_pkgrel` input). The database objects are `no-cache` and are
  uploaded after the package, never before.
- **`allow_missing_packages` means ABSENT, never BROKEN.** The Packaging gate,
  `install-test.sh` and the `arch` job each skip a package that does not exist when the
  input is set; a package that exists and fails to install still blocks Publish. There is
  no input that ships a known-broken package.

---

## 12. Release checklist

```bash
# 0. Node 22 on PATH, npm 10
nvm use && npm install -g npm@10

# 1. Rehearse first: `gh workflow run sirius-release.yml --ref sirius` runs the
#    whole build on the tag candidate with Publish and the Arch upload skipped
#    (branch dispatch fails the `github.ref_type == 'tag'` gate). Expect green
#    everywhere: two linux legs, seven install legs (x64 and arm64), arch,
#    windows. Read the two Packaging gate summaries (deb, rpm, both ABI floors,
#    ELF architecture) and the seven Install test summaries.
# 2. Bump — exactly three lines, by hand, never `npm install` (that rewrote the
#    whole lock once): package.json:3, package-lock.json:3, package-lock.json:9.
#    Commit subject is the bare version, as every prior bump (d4ad0d51114).
#    <X.Y.Z> below is the NEW version (v1.118.6 is already tagged; next is 1.118.7).
git commit -m "<X.Y.Z>"
# 3. Push the branch first (silent — nothing triggers on a branch push), then an
#    ANNOTATED tag pushed BY NAME. All shipped tags are annotated; `--tags` would
#    push every stray local tag.
git push origin sirius
git tag -a v<X.Y.Z> -m "Sirius IDE <X.Y.Z>"
git push origin v<X.Y.Z>      # <- this is the ship

# 4. CI builds linux x64/arm64 (+ the REH server; arm64 cross-compiled) and
#    win32, installs the .deb/.rpm/server in Debian 12, Ubuntu 22.04 and Rocky 9
#    containers on x64 AND arm64 hardware, builds
#    and installs the Arch package, then attests, releases (gh), mirrors to R2,
#    writes latest-stable.json, and publishes the Arch repository. Watch it:
gh run watch --repo sirius-ide/sirius-ide
#    RED for packaging or for an install test is a real failure: Publish needs
#    linux, install-test and arch all green. If you have decided to ship without
#    a package that could not be BUILT, dispatch against the TAG (a branch
#    dispatch is skipped by the Publish gate; "Re-run failed jobs" replays the
#    push event with no inputs):
#    gh workflow run sirius-release.yml --ref v<X.Y.Z> -f allow_missing_packages=true
#    A package that built but fails to install cannot be shipped by any input.

# 5. Confirm the update server and the Arch repository see it — EVERY platform. v1.118.6
#    was green on CI and still offered arm64 desktops the REH server tarball until this
#    check caught it (§13). Each platform must name its own asset, with the sha256 from
#    that asset's own .sha256; a client already on the new commit must get 204.
for p in linux-x64 linux-arm64 win32-x64; do
  curl -fsS https://update.siriuside.com/api/update/$p/stable/0000000000000000000000000000000000000000; echo
done
curl -fsSL https://dl.siriuside.com/arch/x86_64/sirius.db | tar -tz | grep sirius-ide-bin

# 6. If the same version must be republished to the Arch repo (rebuilt bytes
#    under an existing package name are refused), dispatch against the tag with
#    -f arch_pkgrel=2. There is no manual step left.
```

Verify provenance of any asset: `gh attestation verify <file> --owner sirius-ide`.

---

## 13. If you are a new session, start here

**Last handoff (2026-09-30, cloud session): the arm64 sysroot cross-build is done and
rehearsed green on branch `claude/busy-davinci-2vct4i` — NOT yet on `sirius`, not yet in a
release.** Five commits, cherry-pick them all — the four below and the state-doc commit after
them: `aad0383` (the cross-build itself: arm64 built
on the x64 runner through the aarch64 glibc-2.28 sysroot, `.deb`/`.rpm` for arm64, seven
required install-test legs, `install-test.sh` architecture-aware, INSTALL.md), `442d28b`
(from two Opus reviews: job-level `VSCODE_ARCH` — without it every arm64 artifact carried
x86-64 MSAL binaries; `build/sirius/dlopen-smoke.cjs` shared by the linux job and every
install leg; a strict `ldd`; `build/sirius/elf-arch.sh`; the ABI and ELF checks reporting
through the Packaging gate), `87854aa` (from the third review, which cross-compiled the
modules locally: `node build/npm/preinstall.ts` by hand before `npm ci` — npm 10 runs the root
preinstall only after reify, so the V8 `<source_location>` patch came too late for the
sysroot's gcc 10.5 and native-keymap failed — plus `ELECTRON_SKIP_BINARY_DOWNLOAD` and the
predicted arm64 deb list), `44447de` (the deb list as the first rehearsal measured it:
`libstdc++6 (>= 5)`, not `(>= 5.2)`). Rehearsal 36786333471 was green everywhere but that one
deb line; rehearsal 36788412045 is green in all 13 jobs.

**Verified by that run (§9):** the arm64 leg cross-compiles on `ubuntu-22.04`; 16 client
binaries at glibc ≤ 2.28 / GLIBCXX ≤ 3.4.26 and 9 server binaries at ≤ 3.4.25; all 39 ELF
files aarch64 (the sandbox runtime's per-arch seccomp helpers exempt); the aarch64 rpm and
arm64 deb dependency lists byte-exact; and on arm64 hardware the `.deb` installs and runs on
Debian 12 and Ubuntu 22.04, the `.rpm` on Rocky 9, the tarball on Debian 12 — every leg
dlopens 9 client modules under Electron 39.8.8 and 6 server modules under Node 22.22.1, shows
a window for 60 s, and the server answers `/version` with the commit. x64, Windows, the Arch
package and the Arch repository rehearsal stayed green. **Not exercised:** the tag-only Publish
path with the four extra arm64 assets (the release upload and R2 mirror are per-file and
arch-agnostic, so nothing arm64-specific is untested there), and any user install on a distro
outside the three tested — INSTALL.md's "Debian 11 / Ubuntu 20.04 or newer" for arm64 comes
from the ABI numbers, not from a run. INSTALL.md describes the arm64 packages as "from the
first release after v1.118.6", so land the branch with the tag that ships them; until then
v1.118.6's live arm64 tarball and server keep the native build's glibc 2.38 floor.

**Previous handoff (2026-09-30, local): v1.118.6 is live** — tag run 36773757646, GitHub
release, R2 mirror, update manifest and Arch repository all verified from the outside (§7).
The update worker's suffix-match defect (arm64 desktops were offered the server tarball) is
fixed in `db3e2b6` and deployed as worker version `b8394745` (rollback target `2125f6cc`).
Dependabot PRs #1–#4 are closed; #5 is moot and left for Dependabot.

**Next, in order** (one branch per item; the owner merges by cherry-pick):
(1) **owner:** cherry-pick the five commits above onto `sirius` and tag 1.118.7 — the tag is
what makes arm64's packages and floor real for users; (2) **cloud, small:** harden
`build/sirius/publish-arch-repo.sh` — a failed fetch of the live database is treated as a
first publish, which skips the downgrade check; tell "absent" (404) from "failed" — and land
it before the next tag, which reruns `arch-publish`; (3) **cloud for the code, owner for the
rest:** the website (hole 2) — DNS and the Cloudflare Pages deploy need the owner's token;
(4) **local-only:** the live Anthropic/Gemini/vision runs and the remote-extension connect
(hole 12).

1. `git log --oneline -20` — this file can lag; the log cannot.
2. `git status` and `git log origin/sirius..HEAD` — is there unpushed or unreleased work?
3. Read §10 (open holes) and pick from the top.
4. Before claiming any editor-integration works, prove it with `test/harness/run.sh`.
5. Node 22 or nothing (§8).

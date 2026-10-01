# Sirius IDE — Project State

**Last full audit: 2026-09-30** (against code at `10f1cc8d`) · released `v1.118.7` (2026-10-01; eight releases `v1.118.0`…`v1.118.7`) · the release train ships the REH server and `.deb`/`.rpm` for x64 and arm64 (arm64 cross-compiled at a glibc-2.28 floor since v1.118.7), proves each install in Debian 12 / Ubuntu 22.04 / Rocky 9 on its own architecture, and publishes the Arch repo itself — all verified from the outside on the v1.118.7 tag (§13) · shipping

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
| Release CI | ✅ tag → Linux x64/arm64 + Windows x64, attested, mirrored to R2. **Since v1.118.7 (2026-10-01, tag run 36803858361, 13/13 green): arm64 is cross-compiled on the x64 runner through the glibc-2.28 sysroot and ships `.deb`/`.rpm`** |
| Update server | ✅ **live** at `update.siriuside.com`, serving v1.118.7 (verified 2026-10-01, worker version `b8394745`: an old or a 1.118.6 linux-x64 / linux-arm64 / win32-x64 client gets 200 → 1.118.7 with its own asset, the sha256 from that asset's `.sha256` and commit `603044c`; a 1.118.7 client gets 204) |
| Download CDN | ✅ **live** at `dl.siriuside.com` (R2, zero egress) |
| Arch pacman repo | ✅ **automated and live** — every stable tag builds `sirius-ide-bin` from its own tarball, installs it on Arch, and publishes it to `dl.siriuside.com/arch/x86_64` (jobs `arch` + `arch-publish`). First real publish on v1.118.6 (run 36773757646). **On v1.118.7 (run 36803858361) the hardened script (`9f6f202` + `ced0349`) fetched the live database, saw 1.118.6-1 and published 1.118.7-1: `sirius.db` lists exactly `sirius-ide-bin-1.118.7-1`.** The script accepts only 200 / 404 from R2, requires all four database objects present or all absent, and fails closed on anything else; self-tested in every branch rehearsal |
| AUR | ❌ not published (see §11) |
| deb / rpm | ✅ **shipped since v1.118.5** (2026-09-27, the first ever), x64. Built and gated on every run since, and **installed and run in Debian 12 / Ubuntu 22.04 / Rocky 9 containers on every run** (job `install-test`, required by Publish). **arm64 `.deb`/`.rpm`: shipped since v1.118.7** (2026-10-01), built, gated and installed the same way, on arm64 hardware |
| REH server | ✅ **shipped in v1.118.6** — `sirius-server-linux-{x64,arm64}.tar.gz`, the asset `serverDownloadUrlTemplate` promised since v1.118.0; x64 gated at glibc 2.28 / GLIBCXX 3.4.25 and started in the containers. Both template URLs answer 200. Since v1.118.7 the arm64 server has the same 2.28 / 3.4.25 floor and is started in the arm64 containers too |
| macOS | ❌ not built (needs Apple Developer cert) |
| Windows signing | ❌ unsigned — SmartScreen warns |
| Website | ❌ `siriuside.com` has no DNS record at all — **in progress**: the Astro site's design direction is on branch `claude/youthful-pascal-9wsrxd` for the owner's OK (§13, `website/BRIEF.md`) |
| Model layer | ✅ 12 providers, keyring, native tool calling |
| Editor AI surfaces | ✅ registered as language-model vendor + tools + default agent |
| Tab completion | ✅ FIM-based, shipped |
| Next-edit prediction | ✅ shipped (default off, needs local FIM model) |
| Project rules | ✅ shipped (Phase 2 opened) |
| Working tree | see `git status`; this file lags the log |
| Unreleased | `git log --oneline v1.118.7..HEAD` — do not trust a number written here. At 2026-10-01: this state-doc update only |

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

Version tags: `v1.118.0` … `v1.118.7`, all annotated. Everything up to `603044c` ("1.118.7")
is released. v1.118.7 over v1.118.6 is release tooling only — the arm64 cross-build, the Arch
publish hardening, the update-worker fix (deployed separately) and docs; nothing under `src/`
or `extensions/`.

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

## 7. Live infrastructure (verified 2026-10-01)

| Endpoint | Status |
| --- | --- |
| `https://update.siriuside.com/api/update/<platform>/stable/<commit>` | ✅ **200** → v1.118.7 for an older commit (including v1.118.6's), **204** for the v1.118.7 commit, on linux-x64, linux-arm64 and win32-x64; dl CDN URL + a sha256 matching the asset's own `.sha256`. Worker version `b8394745` (rollback target `2125f6cc`) |
| `https://dl.siriuside.com/releases/v1.118.7/<asset>` | ✅ all 17 v1.118.7 assets (tarballs, server tarballs, installer, `.deb` and `.rpm` for amd64/x86_64 and arm64/aarch64, Arch package, checksums) downloaded from the CDN: each the same size as on GitHub, each with a `.sha256` matching it, every one passing `gh attestation verify` |
| `https://dl.siriuside.com/arch/x86_64/sirius.db` | ✅ **200** → lists exactly `sirius-ide-bin-1.118.7-1`, `%SHA256SUM%` = the release asset; `sirius.db` / `sirius.db.tar.gz` and `sirius.files` / `sirius.files.tar.gz` byte-identical, all `no-cache` |
| `https://dl.siriuside.com/` | 404 (expected — bucket root, not an index) |
| `https://siriuside.com` | ❌ **no DNS record** |
| `https://siriuside.dev` | ❌ **no DNS record** |
| GitHub releases | ✅ 8 releases, latest v1.118.7 (2026-10-01) — 17 assets, the first with arm64 `.deb` / `.rpm` (v1.118.6 was the first with the REH server and the Arch package) |

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
| deb / rpm installed on Debian 12 / Ubuntu 22.04 / Rocky 9 | ✅ **CI, every run** (run 36762589539): apt/dnf resolve the generated dependency lists from the distros' own repos, `sirius --version` reports the release commit, all 12 shipped binaries resolve every library, the editor stays up under Xvfb for 60 s with `window1/renderer.log` written, and the server starts and answers `/version`. Since the arm64 cross-build (merged 2026-09-30) every leg also dlopens every native module under the shipped Electron and the server's under its node (`build/sirius/dlopen-smoke.cjs`) |
| deb / rpm / tarball (arm64) | ✅ **shipped in v1.118.7** (tag run 36803858361; first proven in rehearsal 36788412045): cross-compiled on the x64 runner (sysroot aarch64 gcc 10.5 for the client, gcc 8.5 for remote/), ABI floor glibc ≤ 2.28 / GLIBCXX ≤ 3.4.26, every ELF in both trees checked for machine type (`build/sirius/elf-arch.sh`), byte-exact dep-list match, then **installed and run on arm64 hardware**: `.deb` on Debian 12 and Ubuntu 22.04, `.rpm` on Rocky 9, tarball on Debian 12 — the leg that was red for v1.118.6. On the tag run every arm64 leg reported `--version 1.118.7` and `/version` answered `603044c` |
| REH server x64 | ✅ built and gated on CI: 9 server binaries at glibc ≤ 2.28, GLIBCXX ≤ 3.4.25 (the floor `check-requirements.sh` promises); nodejs.org's Node 22.22.1 verified against `build/checksums/nodejs.txt`; `sirius-server --version` and `/version` proven in all three containers. **Not yet exercised by a real remote extension** (Open Remote - SSH from a client): local-only proof |
| REH server arm64 | ✅ shipped in v1.118.7: gated at glibc ≤ 2.28 / GLIBCXX ≤ 3.4.25 like x64, modules dlopen under its node, started and `/version` answered in all four arm64 containers. (v1.118.6's arm64 server had the native runner's glibc 2.38 floor) |
| arm64 tarball on Debian 12 arm64 | ✅ shipped in v1.118.7: installs its dependency set, every binary resolves, every module dlopens, the window comes up. (v1.118.6's tarball did not run there: GLIBC_2.38 / GLIBCXX_3.4.31 from the native build, measured in run 36762589539 and again from the CDN on 2026-10-01) |
| The **published** v1.118.7 Linux artifacts | ✅ 2026-10-01, from the CDN: CI's own `abi-floor.sh` and `elf-arch.sh`, rerun on the published bytes, pass for all eight — tarball, server, `.deb` and `.rpm` for each of x64 and arm64 (client glibc ≤ 2.28 with no libstdc++ on x64 and ≤ 3.4.26 on arm64; server ≤ 2.28 / 3.4.25; every ELF the package's architecture). The same check run on v1.118.6's arm64 tarball and server fails, as it should |
| Arch package | ✅ CI, every run: built with makepkg in `archlinux:base-devel`, `pacman -U` resolves every declared dependency, `sirius --version` correct, 11+ binaries link, desktop files validate; `repo-add` rehearsed on the runner. The R2 upload ran for real on the v1.118.6 tag (run 36773757646). Since `9f6f202` / `ced0349` (on `sirius`, first used by v1.118.7) the publish logic is also proven against a stub R2 by `publish-arch-repo.test.sh` (18 cases: first publish, upgrade, refused downgrade, same-bytes re-run, rebuilt bytes refused, 403 / 500 / no-connection on either database object and on the package object, failed download, four half-repository shapes including the reproduced downgrade, a CLI error format that hides the 404, unreadable database, dry run makes no call) and, by the review, with the real AWS CLI 2.37.7 against a moto S3 mock end to end — rehearsal 36793636385 green, 13/13 jobs, the self-test's 18 `ok` lines in the runner's log; all 18 also pass on Arch with pacman 7.1.0 (2026-10-01, local). **R2 answers HeadObject on a missing key with 404 through the mirror token** — proven by the v1.118.7 tag run, whose package upload only happens after a recognised `(404)` |
| Image input to models | ⚠️ wire format proven for all 4 providers by probe; **no vision model exercised live** (`ollama pull moondream` would close it) |
| Integrated browser tools | ✅ 38 tools on a fresh profile, all seven browser ids present (`test/harness/probes/agent-tools.js`) |
| Tiered / size-aware native tools | ✅ probe-proven: 1.5B → core, ≥ 6 GB → extended |
| Prompted tools on a no-tools model | ✅ probe-proven end to end (`test/harness/probes/prompted-tools.js`): real tool call in 2.6 s, streamed answer in 197 parts |
| macOS | ❌ never built |

---

## 10. Open holes

Ordered by how much they hurt. Last audited against code on 2026-09-30 (`f4688fa`); delete an
item as soon as it is resolved rather than leaving it here. Numbers are stable references
(§13 and other docs cite them), so a deleted item leaves a gap rather than renumbering the rest.

### Blocking users right now

2. **No website.** `siriuside.com` and `siriuside.dev` have no DNS records. Every
   user-facing URL in `product.json` points at GitHub instead. The Cloudflare token
   already carries Pages permissions for exactly this.
   **In progress** (2026-10-01): the site is being built under `website/` to `website/BRIEF.md`;
   the design direction is on branch `claude/youthful-pascal-9wsrxd`, awaiting the owner's OK (§13).

3. **AUR not published.** `sirius-ide-bin` and `sirius-ide-git` PKGBUILDs are ready and
   correct (identity already rewritten to `sirius-ide/sirius-ide`), but nothing is on
   the AUR. Blocked on AUR account registration, which was paused during their
   malicious-packages incident — **re-check whether it has reopened**. The pacman repo
   is the first-class path either way, so this is reach, not function.

### Operational

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
- **`aws s3 cp … 2>/dev/null || echo "first publish"` is a downgrade waiting to happen.**
  That is how `publish-arch-repo.sh` fetched the live database until `9f6f202`: a 403 from
  a rotated token, a timeout or a wrong endpoint all read as "no database yet", skipped the
  downgrade check, and would have replaced the live index with one listing only the run's
  package. Every existence check is now a HeadObject with two accepted answers — 200 and
  404 — and anything else stops the publish with the CLI's message. R2 answers a missing
  key with 404 through the mirror token (observed on the v1.118.7 tag run); S3 would answer
  403 to a token that cannot list the bucket, so if the mirror token is ever narrowed, the tag run stops at `== package object` with a `(403)` in the
  error, and the token scope (not the script) is what to fix. Two more from the review
  (`ced0349`): **check all four database objects**, not just the `.tar.gz` pair — pacman
  reads `sirius.db` / `sirius.files`, and a bucket where the pair was deleted but those
  survived read as a first publish, which then replaced the index clients were using (a
  reproduced downgrade); and **pin `AWS_CLI_ERROR_FORMAT=legacy`** — the `(404)` the
  script looks for is the CLI's default line, but a `cli_error_format` of json / text /
  yaml / table in a `~/.aws/config` drops the parentheses, and every new package key
  would then read as "cannot tell" and stop every tag's publish. A 404 still cannot tell a
  missing *bucket* from a missing key (HEAD has no body): a wrong bucket announces a first
  publish and then fails at the package upload, before any database object — misleading,
  not corrupting, and accepted.
- **`dpkg-shlibdeps.pl` comes from raw.githubusercontent.com and can be a 429 page.**
  `build/linux/debian/calculate-deps.ts` (upstream) downloads Chromium's helper at deb time;
  rehearsal 36792162007's arm64 leg got GitHub's rate-limit page instead and failed with
  `syntax error at /tmp/dpkg-shlibdeps.pl line 1, near "429:"` — the deb is then "missing",
  the Packaging gate fails, and `arch` + `arch-publish` are skipped. It is a transient:
  re-run the job. (It is upstream code; the fork does not patch it.)
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
#    <X.Y.Z> below is the NEW version (v1.118.7 is already tagged; next is 1.118.8).
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

### Landing a cloud branch (owner, local)

Cloud sessions work on `claude/…` branches and stop; they never land or release. To land one:

1. `git fetch`, then check the branch: based on the current `sirius` tip, every commit
   authored and committed as the owner, no attribution trailers
   (`git log --format='%an <%ae> | %cn' origin/sirius..<branch>`, and grep the bodies).
2. Read its rehearsals yourself with `gh run view <id>` — cloud handoffs have misreported
   twice (a commit count; a first rehearsal called nearly green when the arm64 job had
   failed and skipped every install leg). Confirm the last green run's head differs from
   the branch tip only in docs (`git diff --stat <run-head> <branch>`).
3. Review the diff, and re-check from this machine anything the VM could not reach: the
   live endpoints, the R2 layout, `dl.siriuside.com`.
4. `git cherry-pick` every commit onto `sirius`, in order — that drops the VM's commit
   signature (GitHub shows it as "Unverified") and keeps `claude/…` out of history — then
   `git diff --quiet HEAD <branch>` must hold before you push.
5. If a PR exists, strip any `claude.ai/code/session_…` link from its body, close it with a
   comment naming the cherry-picked SHAs, and delete the branch
   (`gh pr close <n> --delete-branch`, or `git push origin --delete <branch>`).
6. Bring §13 to the merged state: the new SHAs, and "unreleased until v…" where it applies.

---

## 13. If you are a new session, start here

**Last handoff (2026-10-01, cloud, branch `claude/youthful-pascal-9wsrxd`): the website's design
direction is up for the owner's OK** (`website/BRIEF.md` §7, step 2). Nothing landed, nothing
deployed, no DNS. On the branch, over `f8cc08e`:

- `website/` — the Astro 7.3 + Starlight 0.42 project (`cd website && npm ci && npm run build` →
  `dist/`; `npm run check` clean; Node 22, its own lockfile, never the editor's `npm ci`):
  tokens for both schemes, the Base layout (OS and theme attributes set by an inline script before
  first paint, so the served HTML names no OS; canonical, OpenGraph, manifest, icons), Nav,
  Footer, the vector Logo, the OS-aware DownloadButton, the Hero (the Aurora backdrop and the
  HTML-drawn Sirius window with its once-on-load agent sequence in the product's own strings),
  the "Bring your own model" section with the drawn *Select AI Model* picker, a 404, a Starlight
  stub at `/docs/`, `scripts/screenshots.mjs`, the two OFL fonts (Schibsted Grotesk, JetBrains
  Mono; Latin woff2, 36 KB together) with their licences, and `src/data/release.json`, the
  committed snapshot of v1.118.7's 17 assets the build falls back to.
- `website/design/` — `DIRECTION.md` (type, palette and both schemes, the motion idea, the
  section map, five decisions to confirm) and the renders the owner reviews:
  `home-1440x900-{dark,light}.png`, `home-390x844-{dark,light}.png`, and
  `home-1440x900-dark-mid.png`, the window 5.8 s into its sequence with the diff and the
  Keep / Undo controls on screen.
- `build/sirius/make-icons.py --web DIR` writes the favicon, touch and manifest icons, the
  maskable icon and `og/default.png` (run into `website/public`); `set-identity.mjs` now rewrites
  `website/src/site.config.ts` too; `.eslint-ignore` keeps `website/` out of the editor's lint.
- `LICENSE.txt` §9 names the State of Delaware, United States of America. `SECURITY.md` is the
  Sirius policy: GitHub private vulnerability reporting, scope, latest-release-only, attestation.

**Verified in the VM:** the build and `astro check`; the four renders plus a reduced-motion pass
whose product window is pixel-identical to the settled animated one (reduced motion is the end
state, as the brief requires); landing-page JavaScript is Astro's ClientRouter and prefetch, about
16 KB before compression, and the page HTML is 8 KB gzipped; Astro's fonts API emits
metric-matched fallbacks (`size-adjust` 103.8 % Arial, 99.98 % Courier New). **Written, not
verified:** nothing is deployed, so no Lighthouse, axe or real-device numbers yet — those belong to
the full build. One capture gotcha, not a site bug: Playwright's `fullPage` screenshot re-emulates
the device at capture time and in Chromium that restarts the animations of elements inside the
containers the phone layout hides (a plain resize does not; checked), so the script sizes the
viewport to the page first and takes plain captures.

**The stop.** The owner reviews `website/design/` locally and answers in the cloud; the full build
(BRIEF §7, step 3) starts from the answer and the five decisions in `DIRECTION.md`. Not built yet:
every page beyond `/` (download, docs content, changelog, roadmap, privacy, licence, security),
the three-reasons strip and the other seven feature sections, the comparison table and its
sources file, the media-slots README, `_headers` / `_redirects`, the Lighthouse budget file, axe
and the link checker, `build/cloudflare/deploy-website.sh`, `.github/workflows/sirius-website.yml`,
the token-recipe line for "Dynamic URL Redirects: Edit". The exact deploy steps and the
`product.json` lines come with the full build's handoff, as the brief says.

**Previous handoff (2026-10-01, local): v1.118.7 is live, verified from the outside.** It is the
first release with arm64 `.deb` and `.rpm`, and the first whose arm64 tarball and server hold
the glibc-2.28 floor (cross-compiled through the sysroot; v1.118.6's needed 2.38). Released
commit `603044c` ("1.118.7", annotated tag `v1.118.7`); over v1.118.6 it carries release
tooling only — the arm64 cross-build (`2d98ba0`…`7e3c08c`) and the Arch publish hardening
(`9f6f202`, `ced0349`). Rehearsal 36802537238 (on `680df6e`) and tag run 36803858361 are both
green in all 13 jobs; on the tag run all seven install legs, x64 and arm64 hardware, reported
`--version 1.118.7` and `/version` answered `603044c`.

**Verified from the outside (§7, §9):** all 17 assets downloaded from `dl.siriuside.com` —
each the size GitHub lists, each matching its `.sha256`, each passing `gh attestation verify`;
`commit.txt` is the tag's commit. CI's `abi-floor.sh` and `elf-arch.sh`, rerun on the
published bytes, pass for all eight Linux artifacts — among them the new
`sirius_1.118.7-1790820696_arm64.deb` (Architecture `arm64`, `libc6 (>= 2.28)` the highest
libc it asks for) and `sirius-1.118.7-1790820782.el8.aarch64.rpm` (ARCH `aarch64`,
`GLIBC_2.28` max). The update server offers linux-x64, linux-arm64 and win32-x64 their own
1.118.7 asset with the sidecar sha256 and the commit — 200 to an old or a 1.118.6 client, 204
to a 1.118.7 one. The Arch repository lists exactly `sirius-ide-bin-1.118.7-1`, its
`%SHA256SUM%` the release asset's. The tag run's "Publish Arch repository" log shows the
hardened path end to end: `fetched sirius.db.tar.gz`, `database currently lists
sirius-ide-bin-1.118.6-1`, then the package upload, which the script makes only after a
recognised `(404)` — so **R2 answers HeadObject on a missing key with 404 through the mirror
token**, the question the previous handoff left open. The Windows installer was checked for
size, sha256 and attestation only (it is unsigned, §2). **Not exercised:** a user install on a
distro outside the three CI tests, and the arm64 packages on anything but CI's arm64 runners
(the owner's machine has no arm64 emulation).

**Earlier handoffs, condensed** (details in §9, §11 and the commit messages). 2026-10-01: the
Arch publish hardening landed from cloud branch `claude/friendly-gauss-e7tq9o` — `9f6f202`
(every existence check a HeadObject with only 200 / 404 accepted; anything else stops the
publish) and `ced0349` (all four database objects, `AWS_CLI_ERROR_FORMAT=legacy`, and
`publish-arch-repo.test.sh`, 18 stub-R2 cases run in every branch rehearsal). 2026-09-30: the
arm64 cross-build landed from `claude/busy-davinci-2vct4i` — `2d98ba0` (the cross-build, arm64
packages, seven install legs), `23af06e` (job-level `VSCODE_ARCH`, `dlopen-smoke.cjs`,
`elf-arch.sh`), `b93d738` (the root preinstall run by hand before `npm ci`), `7e3c08c` (the
measured arm64 deb list). 2026-09-30: v1.118.6 went live (tag run 36773757646); the update
worker's suffix-match defect (arm64 desktops were offered the server tarball) is fixed in
`db3e2b6` and deployed as worker version `b8394745` (rollback target `2125f6cc`). Dependabot
PRs #1–#4 are closed; #5 is moot and left for Dependabot.

**Next, in order** (one cloud session per item, each on its own branch; the owner lands it
locally by cherry-pick, §12, before the next item starts — so each builds on the merged state):
(1) **cloud for the code, owner for the rest — in progress on `claude/youthful-pascal-9wsrxd`,
stopped at the design direction for the owner's OK (the handoff above):** the website (hole 2),
to the specification in `website/BRIEF.md` (2026-10-01): a flagship site — Astro + Starlight, the Sirius Star
identity, hard Lighthouse budgets, honest content from the repo's own files — built in two
stops: the design direction (screenshots under `website/design/`) for the owner's OK, then the
full build with screenshot review and two Opus passes. Stop before DNS or any deploy (they
need the owner's token) and write the exact deploy steps here. **Local, alongside it:** real
product footage for the media slots the brief defines (the built app + a local model, via the
`launch` skill), then deploy, DNS, outside checks and the `product.json` URL flip. Done on the
branch: LICENSE.txt §9 names Delaware, USA (the placeholder shipped in every release through
v1.118.7) and Microsoft's SECURITY.md is replaced; GitHub private vulnerability reporting is
already enabled on the repo (2026-10-01);
(2) **cloud, small:** `create_file` inside the chat-editing stream (hole 8), so creating a
file gets the same diff, checkpoint and accept/reject as an edit;
(3) **cloud, propose first:** the onboarding walkthrough written for Sirius (hole 9) — the
steps and wording approved before building, through the walkthrough contribution point
upstream already provides;
(4) **cloud, propose first:** a settings surface for model providers and API keys (hole 10).
The rule "never rebuild UI the editor already provides" applies: the proposal must say which
upstream seam it builds on (settings editor, walkthrough, quick pick, the keyring commands)
and what is genuinely new;
(5) **local-only:** the live Anthropic/Gemini/vision runs and the remote-extension connect
(holes 11, 12).
For the product items (2)–(4), prove the change with `test/harness/run.sh` if the VM can
build and run the app headless (§8); if it cannot, say so and mark the change *unverified*
here — the local landing session proves it in the built app. **Owner decision, not queued:**
rebase debt (hole 13) — catching up with upstream needs a method that keeps the release tags
and fits the cherry-pick landing rule, so it is not a task to hand a session as is.

1. `git log --oneline -20` — this file can lag; the log cannot.
2. `git status` and `git log origin/sirius..HEAD` — is there unpushed or unreleased work?
3. Read §10 (open holes) and pick from the top.
4. Before claiming any editor-integration works, prove it with `test/harness/run.sh`.
5. Node 22 or nothing (§8).

# Sirius IDE

**The agentic, AI-native code editor.** Sirius is a fork of [Visual Studio Code](https://github.com/microsoft/vscode) (Code - OSS) — the same open-source foundation that Google Antigravity and Cursor are built on — reimagined around AI agents and your own branding.

Sirius takes the best ideas from **Antigravity** (autonomous, agent-first workflows) and **Cursor** (Tab autocomplete, inline edit, multi-file Composer, deep codebase context) and brings them together in a single, open, multi-model editor.

## Install

```bash
yay -S sirius-ide-bin          # Arch
```

Debian, Fedora, tarball and Windows are in **[INSTALL.md](INSTALL.md)**, along
with how updates reach you on each.

Sirius needs a model before it can do anything: add a provider key with
`Sirius: Set API Key`, or run models locally with Ollama and send nothing off
your machine.

## What makes Sirius different

- **Bring your own model.** Twelve providers — **Anthropic Claude**, **Google Gemini**, **OpenAI**, OpenRouter, Groq, DeepSeek, Mistral, xAI — and local models through **Ollama**, LM Studio, llama.cpp or vLLM. No vendor lock-in, and no account to create.
- **Agentic by default.** Sirius supplies the editor's agent mode with its tools — read, edit, search, run — so it plans and works across files rather than only answering.
- **No telemetry.** Nothing is collected, and there is no relay: requests go straight from your machine to the provider you chose. See [PRIVACY.md](PRIVACY.md).
- **Inline AI.** Explain, fix, test, and refactor any selection straight from the editor.
- **Open extension gallery.** Ships with the [Open VSX](https://open-vsx.org) marketplace out of the box.
- **Signature look.** The "Sirius Star Dark" theme — deep space with brilliant star accents.

## Architecture

Sirius is a thin, well-isolated layer on top of Code - OSS so it stays easy to rebase on upstream:

| Path | What it is |
| --- | --- |
| [product.json](product.json) | Sirius branding, protocols, default chat agent, gallery |
| [extensions/sirius-ai/](extensions/sirius-ai) | Model layer: twelve providers, agent tools, inline completions |
| [extensions/theme-sirius-star/](extensions/theme-sirius-star) | Sirius Star Dark theme |
| `src/` | Core editor / workbench (upstream Code - OSS) |

The upstream Microsoft Copilot extension has been removed; `sirius-ai` is the default chat agent.

## Building from source

Sirius builds exactly like VS Code. You need the [VS Code build prerequisites](https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites) and **the exact Node major version pinned in [.nvmrc](.nvmrc)** — the build refuses to run on anything else, and on npm 11.2.0 or newer:

```bash
nvm use              # or otherwise put the pinned Node on PATH
npm install          # install dependencies
npm run watch        # incremental build (keep running)
./scripts/code.sh    # launch Sirius (code.bat on Windows)
```

To build the AI extension on its own (it is part of the normal extension build,
so this is only needed for a focused edit-compile loop):

```bash
npm run gulp compile-extension:sirius-ai
npm run gulp watch-extension:sirius-ai
```

### Producing a release build

```bash
npm run gulp vscode-linux-x64-min    # -> ../VSCode-linux-x64
```

`sirius-ai` is bundled with esbuild for release builds (`dist/extension.js`) and
compiled to `out/` by the watch task during development.

## Roadmap

Sirius is an active, in-progress project. See [ROADMAP.md](ROADMAP.md) for the plan to reach feature parity with — and beyond — Antigravity and Cursor (Tab/next-edit prediction, multi-file Composer, an Agent Manager surface, browser control, codebase indexing, and more).

## Relationship to VS Code

Sirius is a derivative work of `Code - OSS`, the open-source foundation of Visual Studio Code, which is MIT licensed and copyright (c) 2015 - present Microsoft Corporation. That attribution, and every other third-party licence, is reproduced in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Sirius itself is **not** open source — it ships under its own terms, see [LICENSE.txt](LICENSE.txt). It is **not** Visual Studio Code, is not produced or endorsed by Microsoft, and does not use Microsoft's branding, telemetry, or Marketplace. Upstream lives on the `main` branch; all Sirius work lives on the `sirius` branch.

## License

Sirius IDE is proprietary software — see [LICENSE.txt](LICENSE.txt). Third-party
components, including Code - OSS, keep their own licences; those are reproduced in
[ThirdPartyNotices.txt](ThirdPartyNotices.txt).

# Sirius IDE

**The agentic, AI-native code editor.** Sirius is a fork of [Visual Studio Code](https://github.com/microsoft/vscode) (Code - OSS) — the same open-source foundation that Google Antigravity and Cursor are built on — reimagined around AI agents and your own branding.

Sirius takes the best ideas from **Antigravity** (autonomous, agent-first workflows) and **Cursor** (Tab autocomplete, inline edit, multi-file Composer, deep codebase context) and brings them together in a single, open, multi-model editor.

## What makes Sirius different

- **Bring your own model.** First-class support for **Anthropic Claude**, **Google Gemini**, **OpenAI GPT**, and local **Ollama** models — routed automatically per task. No vendor lock-in.
- **Agentic by default.** The built-in `sirius-ai` assistant doesn't just chat — it reads your codebase, plans, runs tools, and edits across files.
- **Thinking mode & tool use.** Toggle extended reasoning and let the agent use tools to inspect the project, run commands, and apply changes.
- **Inline AI.** Explain, fix, test, and refactor any selection straight from the editor.
- **Open extension gallery.** Ships with the [Open VSX](https://open-vsx.org) marketplace out of the box.
- **Signature look.** The "Sirius Star Dark" theme — deep space with brilliant star accents.

## Architecture

Sirius is a thin, well-isolated layer on top of Code - OSS so it stays easy to rebase on upstream:

| Path | What it is |
| --- | --- |
| [product.json](product.json) | Sirius branding, protocols, default chat agent, gallery |
| [extensions/sirius-ai/](extensions/sirius-ai) | Multi-model AI assistant (router, context engine, tools, chat, inline) |
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

Sirius is derived from `Code - OSS` and distributed under the [MIT license](LICENSE.txt). It is **not** Visual Studio Code, is not produced or endorsed by Microsoft, and does not use Microsoft's branding, telemetry, or Marketplace. Upstream lives on the `main` branch; all Sirius work lives on the `sirius` branch.

## License

[MIT](LICENSE.txt)

# Sirius for VS Code

Sirius's own chat for VS Code, with the models you choose — Anthropic (Claude), Google (Gemini), OpenAI (GPT), OpenRouter, Groq, DeepSeek, Mistral, xAI, or a server on your own machine (Ollama, LM Studio, llama.cpp, any OpenAI-compatible endpoint). Your keys, your models, nothing in between.

## The panel

Sirius has a panel of its own in the secondary side bar, or in an editor tab.

- **Ask, Edit or Agent.** Ask answers questions about your code. Edit changes your files. Agent works through a task step by step with tools.
- **Thinking you can read.** A reasoning model's thinking streams as it happens, folds away when the answer starts, and opens again with a click. Anthropic's and Gemini's reasoning is kept and sent back exactly as they require, so those models keep it across tool calls and turns.
- **Changes you review.** Each change to a file opens in VS Code's diff editor, to accept or reject — one at a time or all together — and Undo takes it back. Or choose **Auto-accept edits**. Files that can run code or change the build (`.vscode/*.json`, `package.json`, lock files, `.env`) are never accepted automatically, and nothing inside `.git` is ever written.
- **Tools, and the ones that ask first.** Sirius reads, searches and lists your workspace and sees its problems on its own. In Agent it can also use other extensions' tools and the MCP servers VS Code knows; each of those asks first, showing what it will run with.
- **Context.** Your selection, or the lines around your cursor, in the file you are in go with your message until you switch them off. Type **@** to add a workspace file, attach files, or paste a picture for a model that can see.
- **Code blocks.** **Insert** at the cursor, **Apply** as a change to review, or **Copy**.
- **Conversations that stay**, for each workspace, after a reload too.

## Tab completion

Code as you type, from a code model on your own machine: Ollama with a coder model (for example `qwen2.5-coder`), or llama-server. It is off until you turn it on — **Sirius: Turn On Tab Completion**, or the **Tab** item in the status bar, which also says which model fills in.

## Commit messages

In Source Control, **Write Commit Message** (the sparkle at the top) writes the message for your staged changes — or, when nothing is staged, your changes to tracked files — with the model chosen in Sirius.

## Your keys, your requests

- **Keys** are kept in VS Code's secret storage, encrypted by your operating system's keyring. They are never written to your settings, and a saved key is never sent back to the panel's page.
- **Requests go straight** to the provider you chose, or to your own server. Sirius runs no proxy and no relay.
- **In a remote window** (SSH, WSL, a container) Sirius runs where your workspace is: its requests leave from there, and the local servers it looks for are that machine's.
- **No address from a workspace.** A provider's or local server's address is its usual one, or the one you saved in **Models and Keys** — never one a workspace's settings name.
- **No telemetry.** Sirius collects nothing: no usage data, no crash reports, no account. The [privacy statement](https://siriuside.com/privacy/#sirius-for-vs-code) says what is sent, what is kept, and where.

## Getting started

1. Open Sirius from the secondary side bar, or run **Sirius: Open Sirius**.
2. In **Models and Keys** (the gear), add a provider's key — or start Ollama, LM Studio or llama.cpp, which Sirius finds at their usual addresses.
3. Ask.

**Get started with Sirius** in the Welcome page walks through each step.

Needs VS Code 1.145 or later.

## Sirius IDE

Sirius is also an editor of its own, with this assistant built in: [siriuside.com](https://siriuside.com). There, this extension is not needed.

## Support

Questions and problems: [GitHub issues](https://github.com/sirius-ide/sirius-ide/issues).

Licensed under [Sirius's licence agreement](https://siriuside.com/license/), a copy of which is in this package as `LICENSE.txt`. The licences of the code it includes are in its `licenses` folder.

# Sirius IDE — Roadmap

Sirius is an agentic code editor: a fork of Code - OSS with chat, an agent that works across
your files, Tab completion and next-edit prediction on a local model, and your own choice of
model provider — hosted or on your machine.

This is where it is going. There are no dates: an item moves when it ships, and the
[changelog](https://siriuside.com/changelog/) is the record of what has.

## Now — shipped and in every download

- Chat in three modes — Ask, Edit and Agent — against any of twelve providers, plus agents
  you define yourself.
- Providers and keys set up in **Manage Models**, keys kept in the system keyring; local
  models through Ollama, LM Studio, llama.cpp and vLLM, with nothing leaving your machine.
- Tab completion and next-edit prediction on local fill-in-the-middle models.
- The agent's tools reach into MCP servers and other extensions; project rules, image input,
  an integrated browser and settings import from VS Code, Cursor and Windsurf.
- Linux on x64 and arm64 (`.deb`, `.rpm`, tarball, an Arch pacman repository), a Windows
  installer, and a remote server for SSH development.

## Next

- **macOS** — signed and notarised builds ([issue #9](https://github.com/sirius-ide/sirius-ide/issues/9)).
- **A code-signed Windows installer**, so SmartScreen stops warning on first run.
- **Arch Linux on the AUR**, beside the pacman repository.
- **Better Tab completions** — suggestions that stop at the end of the block, with more of
  the file as context.
- **Codebase-aware context** — an index of your project, so the agent finds the right files
  without being told where to look.

## Later

- **Longer-running agent tasks** — plan, change, run and verify a multi-step change, with
  checkpoints you can step back through.
- **Smoother upgrades from other editors** — more of your setup carried over, more editors
  recognised.
- **Web and tunnel access** to a running Sirius server.

Something missing? Open a [feature request](https://github.com/sirius-ide/sirius-ide/issues/new/choose).

# Sirius IDE — Agent Instructions

This file provides instructions for AI coding agents working in the Sirius IDE codebase.

## What this project is

Sirius IDE is a fork of Visual Studio Code (Code - OSS), in the same spirit as Google Antigravity and Cursor. It is an agentic, AI-native editor with multi-model support. See [README.md](README.md) and [ROADMAP.md](ROADMAP.md) for the product vision.

## Where Sirius-specific code lives

Keep the fork thin so it stays easy to rebase on upstream. Sirius changes are concentrated in:

- `product.json` — branding, protocols, default chat agent, extension gallery
- `extensions/sirius-ai/` — the multi-model AI assistant
- `extensions/theme-sirius-star/` — the Sirius Star Dark theme
- `build/hygiene.ts` — fork-specific pre-commit adjustments

Everything under `src/` is upstream Code - OSS; prefer additive, well-isolated changes there.

## Branching

- `main` — clean mirror of upstream `microsoft/vscode` (remote: `upstream`).
- `sirius` — all Sirius work. This is the active branch.

## Architecture, coding guidelines, and validation

The upstream codebase overview, layered architecture, TypeScript coding guidelines, and build/validation steps still apply. See the [Copilot Instructions](.github/copilot-instructions.md) for the detailed reference.

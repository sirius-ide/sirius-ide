# Privacy

Sirius IDE collects nothing. There is no telemetry, no crash reporting, no usage
analytics, and no account.

This is not a setting you have to find and turn off. There is no code in Sirius
that reports anything about you anywhere.

## What leaves your machine, and only when you ask

Sirius talks to a model provider when you send it something — a chat message, an
inline edit, a completion. What goes with that request is what the model needs
to answer:

- the text of your prompt
- whatever context you attached or the editor included (a selection, a file, a
  tool result)
- the contents of files a tool read, if the model called one

That request goes **directly from your machine to the provider you chose**.
Sirius operates no proxy and no relay, so nothing routes through us and there is
nothing for us to log.

Your use of a provider is governed by your agreement with that provider, not by
this document. Their policies are the ones that apply to what you send them:

| Provider | Policy |
| --- | --- |
| Anthropic | <https://www.anthropic.com/legal/privacy> |
| Google (Gemini) | <https://policies.google.com/privacy> |
| OpenAI | <https://openai.com/policies/privacy-policy> |
| OpenRouter, Groq, DeepSeek, Mistral, xAI | see each provider's own policy |

## Nothing leaves your machine at all, if you want

Ollama, LM Studio, llama.cpp and vLLM run models on your own hardware. Configure
one of those and no prompt, file or fragment of code reaches any third party.

## Your API keys

Keys are stored in your operating system's keyring — libsecret on Linux, the
Keychain on macOS, the Credential Manager on Windows — through the editor's
secret storage.

Keys are never written to `settings.json`, never synchronised, and never sent
anywhere except to the provider they belong to. Earlier builds did store them in
`settings.json`; if you used one, Sirius moves that key into the keyring on
startup and clears the setting.

## What Sirius stores locally

Ordinary editor state, in your profile directory: settings, keybindings,
extensions, workspace history, chat history. It stays on your machine.

## Extensions

Sirius ships with the [Open VSX](https://open-vsx.org) marketplace. Extensions
you install are third-party software with their own behaviour and their own
privacy practices. Nothing in this document constrains what an extension does.

## Update checks

If you build or install Sirius with an update channel configured, it periodically
asks the update server whether a newer build exists. That request carries the
platform, channel and current build commit — enough to answer the question, and
no identifier for you or your machine.

Installing from a distribution package (for example the AUR) means updates come
from your package manager, and Sirius makes no update request at all.

## Changes

Material changes to this document will be noted in the release notes.

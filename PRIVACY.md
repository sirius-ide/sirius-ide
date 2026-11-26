# Privacy

Sirius IDE collects nothing. There is no telemetry, no crash reporting, no usage
analytics, and no account.

This is not a setting you have to find and turn off. There is no code in Sirius
that reports anything about you anywhere.

The sections that follow describe Sirius IDE. Sirius for VS Code, the
extension, collects nothing either, and has
[a section of its own](#sirius-for-vs-code) further down.

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

Requests to OpenRouter also carry two headers that name Sirius — the
product's name (Sirius IDE, or Sirius for VS Code) and its GitHub address —
which OpenRouter uses to tell one app's traffic from another's. They say
nothing about you.

## Nothing leaves your machine at all, if you want

Ollama, LM Studio, llama.cpp and vLLM run models on your own hardware. Configure
one of those and no prompt, file or fragment of code reaches any third party.

## Your API keys

Keys are kept in the editor's secret storage, encrypted with your operating
system's own facility — DPAPI on Windows, the Keychain on macOS, libsecret or
KWallet on Linux. On a Linux desktop with no keyring available, the editor says
so and asks before falling back to weaker encryption.

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

Every Sirius install checks for updates — 30 seconds after it starts, then
hourly — by asking `update.siriuside.com` whether a newer build exists. The
request names the platform, the release channel and the build commit you run,
which is enough to answer the question, and carries the headers any request
carries, including a User-Agent that names the editor and the operating system.
It contains no identifier for you or your machine. The update server is a
Cloudflare Worker that writes no logs; Cloudflare's own handling of the request
is covered by its privacy policy.

Installs from a distribution package — the `.deb`, the `.rpm`, the `[sirius]`
pacman repository — make the same check, even though your package manager is
what installs the update.

To turn the check off, set `"update.mode": "none"` in your settings, or
`"manual"` to check only when you ask.

## Sirius for VS Code

Sirius for VS Code is the extension: Sirius's chat panel, Tab completion and
commit messages inside Visual Studio Code, or another editor that runs its
extensions. It has no telemetry, no crash reporting, no usage analytics and no
account, and no code in it reports anything about you to us or to anyone else.
The sections above describe Sirius IDE; this one, with the providers' policies
listed above, is the whole statement for the extension.

### What it sends, and when

The extension sends your content only for something you asked for: to the
provider or server whose model you chose and, in Agent, to a tool from
elsewhere that you allowed.

- **A message in the panel** carries your words, the conversation so far, and
  the context shown with the message box:
  - from the file you are in, your selection — or, with none, up to 60 lines
    either side of the cursor — 6,000 characters at most, with the file's path
    and language, until you switch them off. The path is the one inside your
    workspace; for a file outside it, its name alone;
  - the files you added: the text of each up to 100 KB — a larger one, or one
    that no longer fits, by name only;
  - the pictures you added, up to four with a message, 3.75 MB each and 6 MB
    together. The pictures of the last two questions that had any go again
    with later messages in the conversation.

  While it answers, the model can read, search and list any file in your
  workspace — `.env` and other files that hold secrets included — and see the
  problems VS Code reports, without asking. What it reads goes to the model
  too.
- **A commit message** carries the diff of your staged changes — or, when
  nothing is staged, of your changes to tracked files — up to 12,000
  characters of it.
- **Tab completion** carries the code around the cursor, up to 2,000
  characters before it and 600 after, to the Ollama or llama.cpp server at the
  address in **Models and Keys** — your own machine, unless you saved another.
  It is off until you turn it on, and a workspace's settings cannot turn it on.
- **Tools from elsewhere.** In Agent, the model can also call the tools that
  other extensions and MCP servers registered with VS Code. Each request tells
  the model about those tools so it can choose among them — their names, their
  descriptions and the inputs they take; for an extension or server with many,
  its name and a line on each until the model opens it. Each call asks first,
  showing what the tool will be given; you allow it once, for this
  conversation, or not at all. What such a tool then does, including any
  request of its own, is that extension's or server's doing.

Each request goes **directly to that provider or server** from the machine the
extension runs on. We operate no proxy and no relay, so nothing passes through
us. The providers' own policies and the note on OpenRouter, above, apply to
what you send them, and with a model on your own hardware nothing reaches a
third party at all.

### What it asks on its own

Until the panel is first shown in a window — VS Code shows it at startup if you
left it open — or you ask for a commit message or choose a completion model,
the extension makes no request at all, unless Tab completion is on: it stays on
from one session to the next, and while it is on the extension asks your server
from startup. The requests it makes on its own are of two kinds; neither
carries your code or your messages:

- **Looking for models.** When the panel is first shown in a window — or a
  commit message is asked for before that — Sirius asks each provider you saved
  a key for to list its models, which sends that provider its key, as every
  request to it does. It also looks for Ollama, LM Studio and llama.cpp at
  their usual addresses on the machine it runs on (ports 11434, 1234 and 8080),
  or at the addresses you saved. It looks again when you change a key or an
  address, when you ask it to, and when the panel is shown again, or you send
  a message, while it has no model — or, for a commit message, while the
  chosen model does not answer.
- **Looking for a completion model.** While Tab completion is on, and when you
  choose its model, Sirius asks your Ollama or llama.cpp server whether it is
  there and which models it has. A llama.cpp key you saved goes with that.

### Your keys and addresses

You type a key into **Models and Keys**, on the panel's page, which hands it to
the extension and clears the field. From there it goes into VS Code's secret
storage, encrypted by your operating system's keyring, and nowhere else: never
into your settings, and a saved key is never sent back to the page. On a Linux
desktop with no keyring available, VS Code says so and asks before falling back
to weaker encryption.

A key is sent only to the provider it belongs to, at that provider's usual
address or the one you saved for it.

A provider's or local server's address is its usual one, or the one you saved
in **Models and Keys**. A workspace's settings cannot change it, so opening
someone else's project cannot send your key or your code somewhere else.

### What it keeps, and where

What the extension keeps, it keeps where VS Code keeps every extension's data,
on your machine. Apart from your keys, none of it is encrypted:

- **Conversations**, for each workspace: your messages, the answers and the
  model's reasoning, with what went to the model alongside them — including
  the text of files that were attached or read. The 200 most recent are kept,
  and deleting a conversation removes it.
- **Pictures** that went with a message, as files in the extension's storage
  folder. Those no kept conversation uses any more are deleted when you delete
  a conversation, and each time the panel is first shown in a window. A window
  with no folder open keeps its pictures in a folder of its own, in
  `panel-images` in VS Code's global storage folder for the extension. When
  that window has been closed for about 30 days, Sirius marks the folder the
  next time the panel is first shown, or a conversation is deleted, in a window
  of the same VS Code on that machine, and deletes it on such an occasion a
  day or more later.
- **Your choices** — the model, the mode, how hard it thinks, whether edits
  are accepted as they come — and the addresses you saved.
- **A log**, under *Sirius* in the Output panel, which VS Code also writes to
  a file in its logs folder: the choices you make, the mode and model of each
  answer, the tools called, and errors. It records that a message was sent,
  never its text.

Sirius's settings — how a message is sent, and Tab completion's switch, model
and length — are ordinary VS Code settings: if you use Settings Sync, VS Code
carries them like any others. Sirius puts nothing else into sync.

What VS Code keeps of an extension once it is uninstalled is VS Code's to
decide. To be sure your conversations and keys do not stay, delete the
conversations and remove the keys in the panel first.

### In a remote window

In a remote window — SSH, WSL, a dev container — the extension runs on the
machine your workspace is on. Its requests leave from that machine, the local
servers it looks for are that machine's, and its pictures and its log are kept
there. Your keys stay in the keyring of the computer you sit at; VS Code passes
one to the extension on the remote machine when a request needs it, and it is
sent from there. Conversations, choices and addresses stay in VS Code's storage
on the computer you sit at.

### The panel's page

The panel is a page inside VS Code. It runs no script but the extension's own.
Styles and fonts load only from `*.vscode-cdn.net`, the domain VS Code serves
extensions' files through, and pictures only from inside the page: a picture
in an answer that is kept anywhere else is shown as a link to it, or by its
description if it has one, never loaded. The page can send nothing anywhere
else. A link in an answer opens in your browser only when you click it.

### What is the editor's, not Sirius's

VS Code — or the editor you installed the extension in — and the Marketplace or
Open VSX registry you installed it from are not ours. The editor's own
telemetry (`telemetry.telemetryLevel` in VS Code) and update checks, and the
registry's record of what you install and update, follow their settings and
policies. Sirius sends nothing through them and does not use VS Code's
telemetry API. As with any extension, the editor's own telemetry, while it is
on, can record that Sirius started, the commands you ran from it, the other
extensions' tools it called and, for each Tab completion suggestion, its
language and whether it was shown and accepted.

The *Extensions* and *Update checks* sections above describe Sirius IDE alone.
The extension makes no update check of its own: the editor updates it from the
registry it came from.

## Changes

Material changes to this document will be noted in the release notes and, for
the extension, in its changelog.

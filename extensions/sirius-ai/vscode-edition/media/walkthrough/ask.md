# Ask, Edit or Agent

Under the message box:

- **Mode:** Ask, Edit or Agent.
- **Edits**, in Edit and Agent: **Ask before edits**, or **Auto-accept edits**.
- **Model:** every model your providers offer.
- **Thinking:** off, or from Low to Max, for a model that reasons. Its thinking streams as it happens and folds away when the answer starts; click it to read it again.

**What goes with your message.** Above the message box, the file you last worked in and your selection show as chips. They go with your message — the selection, or the lines around the cursor — until you click them off. Type **@** to add a file of the workspace, use **Attach files** (the paperclip) for any file, or paste a picture for a model that can see.

**Tools.** In every mode Sirius can read, search and list the files of your workspace and see its problems. In **Agent** it can also use the tools of other extensions and of the MCP servers VS Code knows (**MCP: List Servers**) — a stopped server starts again when one of its tools is used; disable a server to keep its tools out. Each asks you first, showing what it will run with: allow it once, for the whole conversation, or not at all.

**Changes to your files.** In **Edit** and **Agent** Sirius can change files and create new ones. Each change waits on its card and opens in VS Code's diff editor: **Accept** or **Reject** it there or on the card, or a round's changes together with **Accept all** and **Reject all**. An accepted change is applied to the file as it is then, and saved; **Undo** in the file takes it back. With **Auto-accept edits** changes apply as they come, and **Show diff** on a card shows what changed.

An answer shows the tokens it used when its provider reports them. **Stop** ends an answer at once; **Retry** asks again.

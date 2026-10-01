# Media slots

Real product footage is recorded on the owner's machine with the built app and a local
model, then dropped here under the exact file names below. The build picks a file up
automatically: when `<name>.mp4` exists the section shows it (poster `<name>.jpg`, muted,
looped, `playsinline`, lazy, paused under `prefers-reduced-motion` and data-saver); until
then the section shows its stylised SVG stand-in. Nothing here is a fake screenshot.

| Slot (file name) | Where | Dimensions | Poster | What it shows |
| --- | --- | --- | --- | --- |
| `agent-mode.mp4` | `/`, section 01 | 1600×1000, ≤ 1 MB, ≤ 20 s | `agent-mode.jpg` | A request in agent mode; the agent reading and searching files, running a command in the terminal, editing two files; the diff view with Keep / Undo per hunk; Keep All Edits |
| `tab-completion.mp4` | `/`, section 02 | 1600×1000, ≤ 1 MB, ≤ 15 s | `tab-completion.jpg` | Typing in a TypeScript file with Tab completion from a local Ollama FIM model; one ghost-text accept; then next-edit prediction offering a follow-up change as a Tab-able diff |
| `browser-tools.mp4` | `/`, section 05 | 1600×1000, ≤ 1 MB, ≤ 20 s | `browser-tools.jpg` | The agent opening a local page in the integrated browser, clicking, typing and reading the page back |
| `git-assist.mp4` | `/`, section 06 | 1600×1000, ≤ 1 MB, ≤ 12 s | `git-assist.jpg` | The Source Control view: the sparkle on the commit box filling in a message; the merge-conflict action handing the conflicts to the agent |
| `import.mp4` | `/`, section 07 | 1600×1000, ≤ 1 MB, ≤ 12 s | `import.jpg` | "Sirius: Import from VS Code, Cursor, or Windsurf" — the editor picker, the category picker, the summary |
| `remote-server.mp4` | `/`, section 08 | 1600×1000, ≤ 1 MB, ≤ 15 s | `remote-server.jpg` | Unpacking `sirius-server-linux-x64.tar.gz` on a host, starting `bin/sirius-server`, `/version` answering the release commit |

Encode with H.264 (`-pix_fmt yuv420p`, `-movflags +faststart`), no audio track; keep each
under the 1 MB hero-media budget from BRIEF.md §1. Posters are JPEGs at the same size, ≤ 120 KB.
Add a `.webm` beside the `.mp4` if you want AV1/VP9 for smaller transfer; the component lists
both sources when both exist.

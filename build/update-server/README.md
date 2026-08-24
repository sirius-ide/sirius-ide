# Sirius IDE update server

Implements the update protocol the editor's update service speaks, backed by
GitHub Releases. Publishing a release ships an update — there is nothing else to
operate.

```
GET /api/update/{platform}/{quality}/{commit}
  204            already current
  200 + IUpdate  an update is available
```

`platform` is `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`, `darwin`,
`darwin-x64` or `darwin-arm64`. `quality` is `stable` (newest non-prerelease) or
anything else (newest prerelease), so both channels ship from one repository.

## Deploy

```bash
npx wrangler deploy build/update-server/worker.mjs --name sirius-update
```

Then set `updateUrl` in `product.json` to the worker's hostname. It is
`https://update.sirius-ide.dev` today; change it if you deploy elsewhere.

Any host that can run a single fetch handler works — the worker uses only
`fetch`, so it also runs on Deno Deploy or as a small Node service.

## What a release must contain

The workflow in `.github/workflows/sirius-release.yml` produces these, but if you
publish by hand they are the contract:

| Asset | Why |
| --- | --- |
| `commit.txt` | The git SHA of the build. **Required** — the editor compares commits, not versions, so without it no update is ever offered. |
| `sirius-linux-x64.tar.gz` | The Linux build. Suffix matching is what selects the asset. |
| `sirius-win32-x64-setup.exe` | The Windows installer. |
| `<asset>.sha256` | Optional. Supplied to the editor as `sha256hash` when present. |

## How updates actually reach users

Behaviour differs by platform, and this is upstream's design rather than a
choice Sirius makes:

- **Linux** — the editor notifies and opens `downloadUrl`. It does not replace
  itself, because a distro package is not the editor's to overwrite. Users who
  installed from the AUR update with `yay -Syu` and never see this.
- **Windows** — a real in-place update via the installer.
- **macOS** — Squirrel, once macOS builds are signed and notarised.

An update check needs `updateUrl`, `quality` and `commit` in `product.json`.
`commit` is stamped by the build, so a locally built app checks for updates only
when built from a git checkout.

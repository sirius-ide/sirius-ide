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
npx wrangler login
npx wrangler deploy --config build/update-server/wrangler.toml
```

Then set `updateUrl` in `product.json` to the worker's hostname — a
`workers.dev` URL works; the custom domain (`update.sirius-ide.dev`) is a
one-click attach in the Cloudflare dashboard once the zone exists.

Any host that can run a single fetch handler works — the worker uses only
`fetch` — but Cloudflare is the deliberate choice: the update endpoint must
outlive everything else, and here it rides a free tier at the edge with no
servers to keep alive.

## The download path

GitHub Releases is canonical and archival. Downloads themselves are cheapest
and fastest from R2, because R2 charges **no egress** — and bandwidth is the
one real cost of shipping an editor:

1. Create the bucket once: `npx wrangler r2 bucket create sirius-releases`,
   then attach the custom domain `dl.sirius-ide.dev` to it (dashboard → R2 →
   bucket → Settings → Custom Domains).
2. Give the release workflow its mirror credentials: an R2 API token scoped to
   just this bucket, stored as the `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
   secrets, plus the `R2_ENDPOINT` repo variable
   (`https://<account-id>.r2.cloudflarestorage.com`). The mirror step stays
   skipped until the variable exists.
3. Uncomment `DL_BASE` in `wrangler.toml` and redeploy the worker; update
   responses then point at `dl.sirius-ide.dev/releases/<tag>/<asset>` instead
   of GitHub.

The worker still reads release *metadata* (and the `.sha256` sidecars) from
GitHub, so R2 going missing degrades to GitHub URLs rather than breaking
updates.

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

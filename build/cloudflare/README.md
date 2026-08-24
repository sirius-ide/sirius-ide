# Cloudflare deployment

`deploy.sh` does everything Cloudflare-side in one idempotent run: email
routing, the update worker at `update.siriuside.com`, the `sirius-releases` R2
bucket, and `dl.siriuside.com`. It needs one API token, created once.

## The token — create after the domains are registered

Dashboard → profile icon (top right) → **My Profile → API Tokens → Create
Token → Create Custom Token**:

| Scope | Permission | Level |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Email Routing Addresses | Edit |
| Account | Account Settings | Read |
| Zone | Zone | Read |
| Zone | DNS | Edit |
| Zone | Email Routing Rules | Edit |
| Zone | Workers Routes | Edit |

- **Account Resources**: the Clicksora account.
- **Zone Resources**: *Specific zone* → add both `siriuside.com` and
  `siriuside.dev` — which is why the token is created after registration.
  Scoping to the two zones means the token cannot touch any other Clicksora
  property on the account.
- TTL: your call; a year is reasonable. Tokens can be rolled or revoked any
  time from the same page.

## Where the token lives

In a local file, never in a chat, never in the repo:

```bash
mkdir -p ~/.secrets && chmod 700 ~/.secrets
cat > ~/.secrets/cloudflare-sirius.env <<'ENV'
CLOUDFLARE_API_TOKEN=paste-the-token-here
ENV
chmod 600 ~/.secrets/cloudflare-sirius.env
```

`deploy.sh` sources that file itself. `wrangler` picks the token up from the
same environment variable, so no browser login is ever needed.

## What stays manual, and why

- **Registering a domain** — Cloudflare's API manages existing domains but
  does not sell new registrations, and it is a card payment besides.
- **Clicking the destination-verification link** — Cloudflare mails the
  forwarding target (Gmail) once; forwarding starts when it is clicked.
- **Minting the R2 API token for CI** — R2 access keys are only issued in the
  dashboard. Scope it to Object Read & Write on the single `sirius-releases`
  bucket, then hand it to CI with `gh secret set` (the script prints the exact
  commands).

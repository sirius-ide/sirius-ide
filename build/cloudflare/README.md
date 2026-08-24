# Cloudflare deployment

`deploy.sh` does everything Cloudflare-side in one idempotent run: email
routing, the update worker at `update.siriuside.com`, the `sirius-releases` R2
bucket, and `dl.siriuside.com`. It needs one API token, created once.

## The token — create after the domains are registered

Dashboard → profile icon (top right) → **My Profile → API Tokens → Create
Token → Create Custom Token**:

The full-control set — everything needed to operate, debug and grow the
Sirius infrastructure unattended:

| Scope | Permission | Level | Powers |
| --- | --- | --- | --- |
| Account | Workers Scripts | Edit | deploy/roll back the update worker |
| Account | Workers Tail | Read | live log tailing while debugging |
| Account | Workers KV Storage | Edit | worker state, if ever needed |
| Account | Workers R2 Storage | Edit | release bucket + custom domains |
| Account | Cloudflare Pages | Edit | the siriuside.com website + docs |
| Account | Email Routing Addresses | Edit | forwarding destinations |
| Account | Bulk URL Redirects | Edit | siriuside.dev → siriuside.com |
| Account | Account Rulesets | Edit | applies the redirect lists |
| Account | Notifications | Edit | alerts on worker errors / SSL expiry |
| Account | Registrar Domains | Read | watch expiry + renewal state |
| Account | Account Settings | Read | account discovery for tooling |
| Account | Account Analytics | Read | traffic debugging |
| Zone | Zone | Read | zone discovery |
| Zone | Zone Settings | Edit | SSL mode, HTTPS, security level |
| Zone | DNS | Edit | all records |
| Zone | SSL and Certificates | Edit | edge certificates |
| Zone | Cache Purge | Purge | purge stale content |
| Zone | Cache Rules | Edit | caching behaviour |
| Zone | Transform Rules | Edit | redirects, header rewrites |
| Zone | Config Rules | Edit | per-path settings |
| Zone | Page Rules | Edit | the legacy equivalents |
| Zone | Zone WAF | Edit | firewall rules for the two zones |
| Zone | Firewall Services | Edit | same, older grouping (add if shown) |
| Zone | Email Routing Rules | Edit | address → destination rules |
| Zone | Workers Routes | Edit | attach worker custom domains |
| Zone | Health Checks | Edit | monitor the update endpoint |
| Zone | Analytics | Read | per-zone traffic |
| Zone | Logs | Read | request logs while debugging |

Deliberately **excluded**, and why:

- **Billing** — spending stays a human decision.
- **API Tokens / Members** — a token that can mint tokens or manage users can
  escalate itself; operations never needs it.

One honesty note on scope: Zone permissions are pinned to the two siriuside
zones and cannot touch any other Clicksora property. Account-level services
(Workers, R2, Pages) are account-wide by Cloudflare's design — if other
Clicksora workers or buckets live on this same account, this token could see
them. If that matters, the alternative is a separate Cloudflare account for
Sirius; otherwise this is the working set.

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

## Non-interference rule

This Cloudflare account also hosts other Clicksora projects. The standing rule
for every operation run with this token, scripted or ad-hoc:

1. **Zone-scoped powers can't stray** — DNS, cache purge, WAF, SSL, rules are
   pinned by the token to the two siriuside zones. Other zones are physically
   out of reach.
2. **Account-scoped powers act on exact names only** — the worker
   `sirius-update`, the bucket `sirius-releases`, Pages projects prefixed
   `sirius`. Nothing is ever listed-then-acted-on, no wildcards, ever.
3. **No destructive call** (delete, overwrite, settings change) is made against
   any resource without a `sirius` name — under any instruction, including a
   mistaken one. If a request would require it, it gets flagged back instead
   of executed.

`deploy.sh` already conforms: every API call addresses its target by the
constant names at the top of the script.

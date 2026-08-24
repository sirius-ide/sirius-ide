#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Everything Cloudflare-side, in one idempotent run: email routing, the update
# worker, the R2 release bucket, and both custom domains. Preconditions: the
# domains are registered in the account, and an API token (see README.md here)
# sits in ~/.secrets/cloudflare-sirius.env.

set -euo pipefail
cd "$(dirname "$0")/../.."

DOMAIN=siriuside.com
GMAIL=iarshrind@gmail.com
WORKER=sirius-update
BUCKET=sirius-releases

ENV_FILE="${SIRIUS_CF_ENV:-$HOME/.secrets/cloudflare-sirius.env}"
# Parse rather than source: a malformed line must never be executed (or echoed).
if [[ -f "$ENV_FILE" ]]; then
	CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
	export CLOUDFLARE_API_TOKEN
fi
: "${CLOUDFLARE_API_TOKEN:?no token — create one per build/cloudflare/README.md and store it in $ENV_FILE}"

API=https://api.cloudflare.com/client/v4
cf() { local m=$1 p=$2; shift 2; curl -sS -X "$m" "$API$p" \
	-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
pick() { python3 -c "import json,sys
d=json.load(sys.stdin)
try: print(eval(sys.argv[1], {}, {'r': d}))
except Exception: print('')" "$1"; }
ok() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)"; }

echo "== token =="
cf GET /user/tokens/verify | ok && echo "  valid" || { echo "  token invalid"; exit 1; }

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
	CLOUDFLARE_ACCOUNT_ID=$(cf GET /accounts | pick "r['result'][0]['id']")
fi
export CLOUDFLARE_ACCOUNT_ID
echo "  account: $CLOUDFLARE_ACCOUNT_ID"

ZONE=$(cf GET "/zones?name=$DOMAIN" | pick "r['result'][0]['id']")
[[ -n "$ZONE" ]] || { echo "zone $DOMAIN not in this account — register it first"; exit 1; }
echo "  zone $DOMAIN: $ZONE"

echo "== email routing =="
cf POST "/zones/$ZONE/email/routing/enable" >/dev/null || true
# Required MX/TXT records: the API lists them; create any that are missing.
cf GET "/zones/$ZONE/email/routing/dns" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for rec in d.get('result') or []:
	print(f\"{rec['type']}|{rec['name']}|{rec['content']}|{rec.get('priority', '')}\")" | while IFS='|' read -r t n c prio; do
	body="{\"type\":\"$t\",\"name\":\"$n\",\"content\":\"$c\",\"ttl\":300$( [[ -n $prio ]] && echo ",\"priority\":$prio" )}"
	cf POST "/zones/$ZONE/dns_records" --data "$body" >/dev/null 2>&1 || true
done
echo "  routing enabled, records ensured"

# Destination must be verified by the user clicking the mail Cloudflare sends.
cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/email/routing/addresses" \
	--data "{\"email\":\"$GMAIL\"}" >/dev/null 2>&1 || true
for addr in emrys hello; do
	cf POST "/zones/$ZONE/email/routing/rules" --data "{
		\"matchers\":[{\"type\":\"literal\",\"field\":\"to\",\"value\":\"$addr@$DOMAIN\"}],
		\"actions\":[{\"type\":\"forward\",\"value\":[\"$GMAIL\"]}],\"enabled\":true}" >/dev/null 2>&1 || true
done
cf PUT "/zones/$ZONE/email/routing/rules/catch_all" --data "{
	\"matchers\":[{\"type\":\"all\"}],
	\"actions\":[{\"type\":\"forward\",\"value\":[\"$GMAIL\"]}],\"enabled\":true}" >/dev/null
echo "  emrys@/hello@/catch-all → $GMAIL (check Gmail for the one verification link)"

echo "== update worker =="
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"
npx wrangler deploy --config build/update-server/wrangler.toml
cf PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" --data "{
	\"zone_id\":\"$ZONE\",\"hostname\":\"update.$DOMAIN\",
	\"service\":\"$WORKER\",\"environment\":\"production\"}" | ok \
	&& echo "  update.$DOMAIN attached" || echo "  (custom domain attach failed — dashboard: Workers → $WORKER → Domains)"

echo "== release bucket =="
cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" --data "{\"name\":\"$BUCKET\"}" >/dev/null 2>&1 || true
cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/domains/custom" --data "{
	\"domain\":\"dl.$DOMAIN\",\"zoneId\":\"$ZONE\",\"enabled\":true,\"minTLS\":\"1.2\"}" | ok \
	&& echo "  dl.$DOMAIN attached" || echo "  (dl domain: may already exist, or attach in dashboard: R2 → $BUCKET → Settings)"

echo "== CI wiring =="
if gh repo view sirius-ide/sirius-ide >/dev/null 2>&1; then
	gh variable set R2_ENDPOINT -R sirius-ide/sirius-ide \
		-b "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" && echo "  R2_ENDPOINT set"
else
	echo "  repo not created yet — re-run after bootstrap-github.sh to set R2_ENDPOINT"
fi

cat <<DONE

Remaining, in order:
  1. Click the verification link Cloudflare just sent to $GMAIL (once).
  2. R2 API token for CI (dashboard is the only place these are minted):
     R2 → Manage API Tokens → Create — scope: Object Read & Write, ONLY bucket '$BUCKET'.
     Then:  gh secret set R2_ACCESS_KEY_ID -R sirius-ide/sirius-ide
            gh secret set R2_SECRET_ACCESS_KEY -R sirius-ide/sirius-ide
  3. AFTER the first release is mirrored: uncomment DL_BASE in
     build/update-server/wrangler.toml and re-run this script — update responses
     then hand out dl.$DOMAIN URLs. (Earlier and they would 404.)
DONE

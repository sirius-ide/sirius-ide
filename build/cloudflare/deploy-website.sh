#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# siriuside.com on Cloudflare Pages, in the house pattern (see deploy.sh): idempotent, every
# resource addressed by its exact name, the token read from ~/.secrets/cloudflare-sirius.env.
# Run from the owner's machine; the cloud never runs this (PROJECT-STATE §13).
#
#   build/cloudflare/deploy-website.sh build      # npm ci + npm run build + npm test in website/
#   build/cloudflare/deploy-website.sh project    # create the Pages project if it does not exist
#   build/cloudflare/deploy-website.sh upload     # upload website/dist (live on the pages.dev URL only)
#   build/cloudflare/deploy-website.sh domain     # attach siriuside.com to the project
#   build/cloudflare/deploy-website.sh dns        # the DNS records: apex CNAME, www and the .dev placeholders
#   build/cloudflare/deploy-website.sh redirects  # www.siriuside.com and siriuside.dev → siriuside.com (zone Single Redirects)
#   build/cloudflare/deploy-website.sh verify     # curl the live site, the headers and the redirects
#   build/cloudflare/deploy-website.sh all        # the six in order
#
# Steps up to `upload` touch nothing a user can see. `domain`, `dns` and `redirects` are the
# cut-over; run them when the pages.dev deployment looks right. Everything is re-runnable.
# `--dry-run` prints every API call instead of making it.

set -euo pipefail
cd "$(dirname "$0")/../.."

DOMAIN=siriuside.com
ALT_DOMAIN=siriuside.dev
PROJECT=sirius-website        # account-scoped: exact name, never listed-then-acted-on
PRODUCTION_BRANCH=sirius
DIST=website/dist

DRY=0
ARGS=()
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) ARGS+=("$a") ;; esac; done
STEP="${ARGS[0]:-all}"

ENV_FILE="${SIRIUS_CF_ENV:-$HOME/.secrets/cloudflare-sirius.env}"
if [[ -f "$ENV_FILE" ]]; then
	CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
	export CLOUDFLARE_API_TOKEN
fi
if [[ "$STEP" != build ]]; then
	: "${CLOUDFLARE_API_TOKEN:?no token — create one per build/cloudflare/README.md and store it in $ENV_FILE}"
fi

API=https://api.cloudflare.com/client/v4
cf() {
	local m=$1 p=$2; shift 2
	if [[ $DRY = 1 && $m != GET ]]; then echo "  [dry-run] $m $p $*" >&2; echo '{"success":true,"result":{}}'; return; fi
	curl -sS -X "$m" "$API$p" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"
}
pick() { python3 -c "import json,sys
d=json.load(sys.stdin)
try: print(eval(sys.argv[1], {}, {'r': d}))
except Exception: print('')" "$1"; }
ok() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)"; }
errors() { python3 -c "import json,sys; d=json.load(sys.stdin); print('; '.join(e.get('message','') for e in d.get('errors',[])))"; }

account_id() {
	if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
		CLOUDFLARE_ACCOUNT_ID=$(cf GET /accounts | pick "r['result'][0]['id']")
	fi
	export CLOUDFLARE_ACCOUNT_ID
	[[ -n "$CLOUDFLARE_ACCOUNT_ID" ]] || { echo "could not read the account id"; exit 1; }
}
zone_id() { cf GET "/zones?name=$1" | pick "r['result'][0]['id']"; }

step_build() {
	echo "== build =="
	( cd website && npm ci --no-audit --no-fund && npm run build && npm test )
	[[ -f "$DIST/index.html" && -f "$DIST/_headers" ]] || { echo "no build output in $DIST"; exit 1; }
	echo "  built $DIST ($(find "$DIST" -type f | wc -l) files)"
}

step_project() {
	echo "== pages project $PROJECT =="
	account_id
	if cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT" | ok; then
		echo "  exists"
	else
		local out
		out=$(cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" --data "{\"name\":\"$PROJECT\",\"production_branch\":\"$PRODUCTION_BRANCH\"}")
		echo "$out" | ok && echo "  created" || { echo "  create failed: $(echo "$out" | errors)"; exit 1; }
	fi
}

step_upload() {
	echo "== upload $DIST → $PROJECT =="
	account_id
	[[ -f "$DIST/index.html" ]] || { echo "run the build step first"; exit 1; }
	if [[ $DRY = 1 ]]; then echo "  [dry-run] wrangler pages deploy $DIST --project-name $PROJECT --branch $PRODUCTION_BRANCH"; return; fi
	( cd website && npx wrangler pages deploy "$(pwd)/dist" --project-name "$PROJECT" --branch "$PRODUCTION_BRANCH" --commit-dirty=true )
	echo "  live at https://$PROJECT.pages.dev — check it before the cut-over steps"
}

step_domain() {
	echo "== custom domain $DOMAIN on $PROJECT =="
	account_id
	if cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains/$DOMAIN" | ok; then
		echo "  attached"
	else
		local out
		out=$(cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains" --data "{\"name\":\"$DOMAIN\"}")
		echo "$out" | ok && echo "  attached (validates once the DNS step has run)" || { echo "  attach failed: $(echo "$out" | errors)"; exit 1; }
	fi
}

# Create or update one proxied DNS record by exact name and type.
ensure_record() {
	local zone=$1 type=$2 name=$3 content=$4
	local existing
	existing=$(cf GET "/zones/$zone/dns_records?type=$type&name=$name" | pick "r['result'][0]['id']")
	local body="{\"type\":\"$type\",\"name\":\"$name\",\"content\":\"$content\",\"ttl\":1,\"proxied\":true}"
	if [[ -n "$existing" ]]; then
		cf PUT "/zones/$zone/dns_records/$existing" --data "$body" | ok && echo "  $type $name → $content (updated)" || { echo "  $type $name: update failed"; exit 1; }
	else
		cf POST "/zones/$zone/dns_records" --data "$body" | ok && echo "  $type $name → $content (created)" || { echo "  $type $name: create failed"; exit 1; }
	fi
}

step_dns() {
	echo "== dns =="
	local zone alt
	zone=$(zone_id "$DOMAIN"); [[ -n "$zone" ]] || { echo "zone $DOMAIN not in this account"; exit 1; }
	# The apex points at the Pages project (Cloudflare flattens the CNAME); www is a
	# placeholder that only exists so the redirect rule has something to answer on.
	ensure_record "$zone" CNAME "$DOMAIN" "$PROJECT.pages.dev"
	ensure_record "$zone" AAAA "www.$DOMAIN" "100::"
	alt=$(zone_id "$ALT_DOMAIN")
	if [[ -n "$alt" ]]; then
		ensure_record "$alt" AAAA "$ALT_DOMAIN" "100::"
		ensure_record "$alt" AAAA "www.$ALT_DOMAIN" "100::"
	else
		echo "  ($ALT_DOMAIN is not in this account yet — its records and redirect are skipped)"
	fi
}

# One zone-level Single Redirect ruleset per zone; PUT replaces that zone's dynamic-redirect
# phase, which is fine because both zones are Sirius's own. Needs "Dynamic URL Redirects: Edit".
set_redirect() {
	local zone=$1 expr=$2 desc=$3
	local rules
	rules=$(python3 -c "import json,sys; print(json.dumps({'rules':[{'action':'redirect','expression':sys.argv[1],'description':sys.argv[2],'action_parameters':{'from_value':{'status_code':301,'preserve_query_string':True,'target_url':{'expression':'concat(\"https://$DOMAIN\", http.request.uri.path)'}}}}]}))" "$expr" "$desc")
	local out
	out=$(cf PUT "/zones/$zone/rulesets/phases/http_request_dynamic_redirect/entrypoint" --data "$rules")
	echo "$out" | ok && echo "  $desc" || { echo "  redirect failed: $(echo "$out" | errors) — the token may lack 'Dynamic URL Redirects: Edit' (build/cloudflare/README.md); the rule can also be made in the dashboard: Rules → Redirect Rules"; exit 1; }
}

step_redirects() {
	echo "== redirects =="
	local zone alt
	zone=$(zone_id "$DOMAIN"); [[ -n "$zone" ]] || { echo "zone $DOMAIN not in this account"; exit 1; }
	set_redirect "$zone" "(http.host eq \"www.$DOMAIN\")" "sirius: www.$DOMAIN → $DOMAIN"
	alt=$(zone_id "$ALT_DOMAIN")
	if [[ -n "$alt" ]]; then
		set_redirect "$alt" "(http.host eq \"$ALT_DOMAIN\") or (http.host eq \"www.$ALT_DOMAIN\")" "sirius: $ALT_DOMAIN → $DOMAIN"
	fi
}

step_verify() {
	echo "== verify =="
	for u in "https://$DOMAIN/" "https://$DOMAIN/download/" "https://$DOMAIN/docs/" "https://$DOMAIN/rss.xml" "https://$DOMAIN/.well-known/security.txt"; do
		printf '  %-48s ' "$u"; curl -sS -o /dev/null -w '%{http_code} %{time_starttransfer}s\n' --max-time 20 "$u" || true
	done
	echo "  headers on /:"; curl -sSI --max-time 20 "https://$DOMAIN/" | grep -iE '^(content-security-policy|strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|cache-control):' | sed 's/^/    /' || true
	for u in "https://www.$DOMAIN/download/" "https://$ALT_DOMAIN/docs/" "https://www.$ALT_DOMAIN/"; do
		printf '  %-48s ' "$u"; curl -sS -o /dev/null -w '%{http_code} → %{redirect_url}\n' --max-time 20 "$u" || true
	done
	echo "  then: Lighthouse from a real device, every link, both schemes (BRIEF.md §8)."
}

case "$STEP" in
	build) step_build ;;
	project) step_project ;;
	upload) step_upload ;;
	domain) step_domain ;;
	dns) step_dns ;;
	redirects) step_redirects ;;
	verify) step_verify ;;
	all) step_build; step_project; step_upload; step_domain; step_dns; step_redirects; step_verify ;;
	*) echo "usage: $0 {build|project|upload|domain|dns|redirects|verify|all} [--dry-run]"; exit 2 ;;
esac

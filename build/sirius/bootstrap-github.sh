#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Everything GitHub-side that follows org creation, in one idempotent run.
# The org itself must exist first — GitHub has no API to create a free-plan
# organisation, so that single step is done in the browser.
#
#   build/sirius/bootstrap-github.sh          # create repo, push, configure
#   build/sirius/bootstrap-github.sh --tag    # ...then tag v1.118.0 and watch CI

set -euo pipefail
ORG=sirius-ide
REPO=sirius-ide
cd "$(dirname "$0")/../.."

command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "run: gh auth login"; exit 1; }

if ! gh api "orgs/$ORG" >/dev/null 2>&1; then
	echo "Organisation '$ORG' not found on GitHub."
	echo "Create it at https://github.com/account/organizations/new (free plan), then re-run."
	exit 1
fi

if ! gh repo view "$ORG/$REPO" >/dev/null 2>&1; then
	gh repo create "$ORG/$REPO" --public \
		--description "Sirius IDE — the agentic, AI-native code editor" \
		--homepage "https://siriuside.com"
	echo "created $ORG/$REPO"
fi

git remote set-url origin "https://github.com/$ORG/$REPO.git"

# The full VS Code history — several hundred MB, takes minutes. sirius first so
# it can become the default branch; main (the upstream mirror) follows.
git push -u origin sirius
gh repo edit "$ORG/$REPO" --default-branch sirius --delete-branch-on-merge --enable-issues
git push origin main

# Secret scanning + push protection: free on public repos, no reason not to.
gh api -X PATCH "repos/$ORG/$REPO" --input - <<'JSON' >/dev/null || echo "(security toggles: set in Settings → Code security if this failed)"
{ "security_and_analysis": {
	"secret_scanning": { "status": "enabled" },
	"secret_scanning_push_protection": { "status": "enabled" } } }
JSON

echo
echo "Repository ready: https://github.com/$ORG/$REPO"

if [[ "${1:-}" == "--tag" ]]; then
	git tag -a v1.118.0 -m "Sirius IDE 1.118.0 — first release" 2>/dev/null || echo "(tag exists)"
	git push origin v1.118.0
	echo "Release workflow started — watching:"
	gh run watch --repo "$ORG/$REPO" || true
else
	echo "Next: build/sirius/bootstrap-github.sh --tag   (tags v1.118.0, CI builds the release)"
fi

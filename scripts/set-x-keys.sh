#!/usr/bin/env bash
# Store the @waterlevelslk X API keys as GitHub Actions secrets in one go. Each value is read with
# hidden input and piped straight to `gh secret set`, never echoed or written to disk.
# Get them in console.x.com -> Apps -> (the app) -> Keys & Tokens:
#   OAuth 1.0 Keys: Consumer Key -> Regenerate  (API Key + API Key Secret)
#   Access Token "For @waterlevelslk" (Read and write) -> Generate  (Access Token + Access Token Secret)
# Run:  bash scripts/set-x-keys.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ask() { # name, label
  local v
  read -r -s -p "$2: " v; echo
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  if [ -z "$v" ]; then echo "  empty, skipped $1"; return; fi
  printf '%s' "$v" | gh secret set "$1" >/dev/null && echo "  saved $1 (${#v} chars)"
}

ask X_API_KEY "API Key (Consumer Key)"
ask X_API_SECRET "API Key Secret (Consumer Secret)"
ask X_ACCESS_TOKEN "Access Token (for @waterlevelslk)"
ask X_ACCESS_SECRET "Access Token Secret"

echo
echo "Done. Checking with a dry run (posts go to Slack only)..."
gh workflow run x-post.yml -f mode=sample >/dev/null && echo "Started: gh run list -w x-post.yml -L 1"

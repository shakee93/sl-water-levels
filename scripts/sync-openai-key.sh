#!/usr/bin/env bash
# Copy OPENAI_API_KEY from .env.local into GitHub Actions secrets (for the X post writer), without
# printing it. Run:  bash scripts/sync-openai-key.sh
set -euo pipefail
cd "$(dirname "$0")/.."

f=.env.local
[ -f "$f" ] || { echo "$f not found" >&2; exit 1; }
v="$(grep -E '^OPENAI_API_KEY=' "$f" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '[:space:]')"
[ -n "$v" ] || { echo "OPENAI_API_KEY is empty in $f" >&2; exit 1; }
case "$v" in sk-*) ;; *) echo "Value doesn't look like an OpenAI key (should start with sk-); nothing changed." >&2; exit 1 ;; esac

printf '%s' "$v" | gh secret set OPENAI_API_KEY >/dev/null
unset v
echo "Saved OPENAI_API_KEY to GitHub secrets."
echo "Sample X posts (Slack only, DRY RUN): gh workflow run x-post.yml -f mode=sample"

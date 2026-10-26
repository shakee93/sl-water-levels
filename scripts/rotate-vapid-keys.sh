#!/usr/bin/env bash
# Make a fresh Web Push (VAPID) key pair and install it everywhere, without the keys ever being
# printed or pasted:
#   Vercel  (production): VAPID_PUBLIC_KEY            - the site hands it to browsers to subscribe
#   GitHub  (Actions):    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY - the push sender signs with them
# then redeploys production and checks the live site serves the new public key.
# Run from anywhere:  bash scripts/rotate-vapid-keys.sh
# Needs: node (with the repo's node_modules), vercel CLI linked to this project, gh logged in.
# Existing push subscriptions stop working after a rotation; people tap "Tell me when it changes" again.
set -euo pipefail

cd "$(dirname "$0")/.."
SITE="https://waterlevels.lk"

tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

echo "1/5 Generating a new key pair (kept in a private temp folder, never printed)..."
node -e '
  const k = require("web-push").generateVAPIDKeys();
  const fs = require("fs"), d = process.argv[1];
  fs.writeFileSync(d + "/pub", k.publicKey, { mode: 0o600 });
  fs.writeFileSync(d + "/priv", k.privateKey, { mode: 0o600 });
' "$tmp"

# A public key is 65 bytes (starts 0x04): 87 base64url characters beginning with "B".
pub_len=$(wc -c < "$tmp/pub" | tr -d ' ')
pub_first=$(head -c 1 "$tmp/pub")
priv_len=$(wc -c < "$tmp/priv" | tr -d ' ')
if [ "$pub_len" != 87 ] || [ "$pub_first" != "B" ] || [ "$priv_len" != 43 ]; then
  echo "Generated keys look wrong (public $pub_len chars, private $priv_len chars). Nothing was changed." >&2
  exit 1
fi
echo "    ok: public key 87 chars starting with B, private key 43 chars"

echo "2/5 Replacing VAPID_PUBLIC_KEY in Vercel (production)..."
vercel env rm VAPID_PUBLIC_KEY production --yes >/dev/null 2>&1 || true
vercel env add VAPID_PUBLIC_KEY production < "$tmp/pub" >/dev/null
echo "    ok"

echo "3/5 Replacing VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in GitHub Actions secrets..."
gh secret set VAPID_PUBLIC_KEY < "$tmp/pub" >/dev/null
gh secret set VAPID_PRIVATE_KEY < "$tmp/priv" >/dev/null
echo "    ok"

echo "4/5 Redeploying production (takes 1-3 minutes)..."
vercel --prod --yes >/dev/null
echo "    ok"

echo "5/5 Checking the live site serves the new public key..."
want="$(cat "$tmp/pub")"
for i in $(seq 1 20); do
  got="$(curl -s "$SITE/api/push?check=$RANDOM" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.stdout.write(JSON.parse(s).key||"")}catch{}})')"
  if [ "$got" = "$want" ]; then
    echo "    ok: live site has the new key"
    echo
    echo "Done. Now open the app on your phone, go to Your places, and tap \"Tell me when it changes\"."
    exit 0
  fi
  sleep 10
done
echo "    The live site does not show the new key yet (cache or deploy still running)."
echo "    Wait a minute and open $SITE/api/push - 'key' should be 87 characters starting with B."
exit 1

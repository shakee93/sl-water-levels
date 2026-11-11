#!/usr/bin/env bash
# Installs tesseract-ocr for curw-snapshot.yml without depending on any single Ubuntu server.
#
# Why (11 Nov 2026): security.ubuntu.com stopped resolving from the GitHub runners at 14:00 UTC. The old step
# ("apt-get install || (apt-get update && apt-get install)") then spent 13 minutes in apt retries and failed, every 15 minutes,
# for hours: the canal levels went stale and GitHub mailed the owner one "Run failed" per run. The same .deb files were on
# archive.ubuntu.com and the Azure mirror the whole time.
#
# Order, each step bounded in time:
#   1. packages kept from an earlier run (actions/cache restores $DEBS): no network at all;
#   2. apt, download only, short timeouts, no retries;
#   3. the SAME files by the names and hashes apt itself prints (apt-get --print-uris reads the signed package index already on
#      the runner), fetched from the other Ubuntu mirrors and verified against that hash before anything is installed.
# Exit 0 = tesseract works. Exit 1 = it could not be installed (the run then fails, which is what the "pipe-curw" health check
# watches); that takes about 3 minutes, not 13.
set -u

PKGS=${TESSERACT_PKGS:-"tesseract-ocr tesseract-ocr-eng"}
DEBS=${DEBS:-"$HOME/tesseract-debs"}
# Tried in order for step 3. Each must serve the Ubuntu archive layout (.../pool/<component>/...).
MIRRORS=${TESSERACT_MIRRORS:-"http://azure.archive.ubuntu.com/ubuntu http://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu"}
APT_OPTS="-o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o DPkg::Lock::Timeout=60"
SUDO=${SUDO-sudo}

say() { echo "install-tesseract: $*"; }
have() { command -v tesseract >/dev/null 2>&1 && tesseract --version >/dev/null 2>&1; }
done_ok() { $SUDO chown -R "$(id -u)" "$DEBS" 2>/dev/null || true; rm -rf "$DEBS/partial" "$DEBS/lock" 2>/dev/null || true; tesseract --version 2>&1 | head -1; exit 0; }
install_debs() { ls "$DEBS"/*.deb >/dev/null 2>&1 && $SUDO dpkg -i "$DEBS"/*.deb >/dev/null 2>&1 && have; }

mkdir -p "$DEBS"
if have; then say "already installed"; done_ok; fi

# The files apt wants, from the index on the runner (no network): 'URL' <file name> <size> <HASHTYPE>:<hash>
URIS=$(apt-get install -y --no-install-recommends --print-uris -qq $PKGS 2>/dev/null | grep "^'" || true)

# 1. kept from an earlier run. Only trusted when every file apt wants is there with the hash apt expects (a newer runner image
#    may want other versions: then the kept files are dropped and fetched again).
check_hash() { # file, HASHTYPE:hash
  local f=$1 kind=${2%%:*} want=${2#*:} got=""
  case "$kind" in
    SHA512) got=$(sha512sum "$f" 2>/dev/null | cut -d' ' -f1) ;;
    SHA256) got=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1) ;;
    SHA1) got=$(sha1sum "$f" 2>/dev/null | cut -d' ' -f1) ;;
    MD5Sum) got=$(md5sum "$f" 2>/dev/null | cut -d' ' -f1) ;;
    *) return 1 ;;
  esac
  [ -n "$got" ] && [ "$got" = "$want" ]
}
all_present() { # every wanted file exists in $DEBS with the right hash
  [ -n "$URIS" ] || return 1
  local ok=0 line name hash
  while IFS= read -r line; do
    name=$(echo "$line" | awk '{print $2}'); hash=$(echo "$line" | awk '{print $4}')
    [ -f "$DEBS/$name" ] && check_hash "$DEBS/$name" "$hash" || ok=1
  done <<< "$URIS"
  return $ok
}
if ls "$DEBS"/*.deb >/dev/null 2>&1; then
  # no index to check against (apt cannot plan): the kept files came from an earlier verified install of this repository's own job, so try them
  if { [ -z "$URIS" ] || all_present; } && install_debs; then say "installed from the packages kept from an earlier run (no network)"; done_ok; fi
  say "kept packages do not match what this runner image needs; fetching again"
  rm -f "$DEBS"/*.deb
fi

if [ -z "$URIS" ]; then
  # apt could not even plan the install from its local index: refresh the index once (bounded), then plan again
  say "apt has no usable package index; refreshing it"
  timeout 150 $SUDO apt-get update -qq $APT_OPTS >/dev/null 2>&1 || true
  URIS=$(apt-get install -y --no-install-recommends --print-uris -qq $PKGS 2>/dev/null | grep "^'" || true)
fi

# 2. apt itself, download only into $DEBS (so the files can be kept), short timeouts
mkdir -p "$DEBS/partial"
if timeout 100 $SUDO apt-get install -y -qq --no-install-recommends --download-only $APT_OPTS -o Dir::Cache::archives="$DEBS" $PKGS >/dev/null 2>&1 && install_debs; then
  say "installed through apt"; done_ok
fi
say "apt could not fetch the packages from its default servers; trying the other Ubuntu mirrors"
echo "::warning title=tesseract::apt's default servers did not deliver the packages; falling back to other mirrors (see scripts/install-tesseract.sh)"

# 3. the same files from other mirrors, verified against the hash apt printed
if [ -z "$URIS" ]; then say "apt could not say which files it needs"; echo "::error title=tesseract::could not be installed (no package index)"; exit 1; fi
$SUDO rm -rf "$DEBS/partial" "$DEBS/lock" 2>/dev/null || true
$SUDO chown -R "$(id -u)" "$DEBS" 2>/dev/null || true
fail=0
while IFS= read -r line; do
  url=$(echo "$line" | awk '{print $1}' | tr -d "'")
  name=$(echo "$line" | awk '{print $2}')
  hash=$(echo "$line" | awk '{print $4}')
  path=$(echo "$url" | sed -E 's#^.*/(pool/.*)$#\1#')
  case "$path" in pool/*) ;; *) say "unexpected package address for $name"; fail=1; continue ;; esac
  if [ -f "$DEBS/$name" ] && check_hash "$DEBS/$name" "$hash"; then continue; fi
  got=0
  for m in $MIRRORS; do
    if curl -fsSL --connect-timeout 10 --max-time 60 -o "$DEBS/$name.part" "$m/$path" 2>/dev/null && check_hash "$DEBS/$name.part" "$hash"; then
      mv "$DEBS/$name.part" "$DEBS/$name"; got=1; say "fetched $name from ${m#*://}"; break
    fi
    rm -f "$DEBS/$name.part"
  done
  [ "$got" = 1 ] || { say "no mirror delivered a correct copy of $name"; fail=1; }
done <<< "$URIS"

if [ "$fail" = 0 ] && install_debs; then say "installed from the fallback mirrors (hashes verified)"; done_ok; fi
rm -f "$DEBS"/*.deb "$DEBS"/*.part 2>/dev/null || true
echo "::error title=tesseract::could not be installed: apt's servers and every fallback mirror failed"
exit 1

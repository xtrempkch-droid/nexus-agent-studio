#!/bin/sh
# Screenshot or DOM-dump a local URL with whatever Chromium is already installed.
#
# Why this exists: the UI can only be verified by rendering it, and adding
# Playwright to verify a layout is a dependency the project does not need. A
# system Chromium does the two things that catch real bugs — look at the pixels
# and grep the rendered DOM.
#
# Usage:
#   sh ui-shot.sh <url> [output-file] [shot|dom]
#   sh ui-shot.sh http://localhost:5173/ /home/me/ui.png
#   sh ui-shot.sh http://localhost:5173/ /home/me/ui.html dom
#
# Exit codes: 0 ok, 1 no browser / no URL, 2 bad usage, 3 browser ran but failed.

set -eu

url=${1:-}
out=${2:-"$HOME/ui-shot-$(date +%Y%m%d-%H%M%S).png"}
mode=${3:-shot}

case $mode in
  shot | dom) ;;
  *)
    echo "mode must be 'shot' or 'dom', got '$mode'" >&2
    exit 2
    ;;
esac

if [ -z "$url" ]; then
  echo "usage: sh ui-shot.sh <url> [output-file] [shot|dom]" >&2
  exit 2
fi

find_browser() {
  for candidate in chromium chromium-browser google-chrome google-chrome-stable \
    /snap/bin/chromium microsoft-edge microsoft-edge-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

browser=$(find_browser) || {
  echo "no Chromium/Chrome found. Tried: chromium, chromium-browser," >&2
  echo "google-chrome, /snap/bin/chromium, microsoft-edge." >&2
  echo "Install one, or use the Playwright path in SKILL.md." >&2
  exit 1
}

# A snap-packaged Chromium has a private /tmp: a screenshot written there reports
# success and never appears in the real /tmp. Refuse the confusing case early.
case $browser in
  /snap/*)
    case $out in
      /tmp/*)
        echo "warning: $browser is a snap, whose /tmp is private." >&2
        echo "writing to $HOME instead of $out" >&2
        base=$(basename "$out")
        out="$HOME/$base"
        ;;
    esac
    ;;
esac

case $url in
  *localhost* | *127.0.0.1*) ;;
  *)
    echo "warning: '$url' is not localhost — this script is meant for the dev" >&2
    echo "server, not for browsing the web." >&2
    ;;
esac

if command -v curl >/dev/null 2>&1; then
  # `|| code=000`: curl exits non-zero when it cannot connect, and the -w output
  # would otherwise be doubled ("000000") — a string that matches nothing.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null) || code="000"
  if [ "$code" = "000" ] || [ -z "$code" ]; then
    echo "nothing is listening at $url — start the dev server first:" >&2
    echo "  npm run dev:desktop -- --port 5199 --strictPort" >&2
    exit 3
  fi
  echo "server answered HTTP $code" >&2
fi

# --virtual-time-budget gives React time to mount; without it the capture is an
# empty #root and the conclusion "the UI is broken" is wrong.
common_flags='--headless=new --disable-gpu --no-sandbox --hide-scrollbars --virtual-time-budget=6000'

if [ "$mode" = "dom" ]; then
  # shellcheck disable=SC2086
  "$browser" $common_flags --dump-dom "$url" >"$out" 2>"$out.err" || {
    echo "browser failed; see $out.err" >&2
    exit 3
  }
  bytes=$(wc -c <"$out" | tr -d ' ')
  echo "DOM written: $out ($bytes bytes)" >&2
  if [ "$bytes" -lt 2000 ]; then
    echo "warning: less than 2 kB — the page probably did not render" >&2
  fi
else
  # shellcheck disable=SC2086
  "$browser" $common_flags --window-size=1600,1000 --screenshot="$out" "$url" \
    >/dev/null 2>&1 || {
    echo "browser failed to capture $url" >&2
    exit 3
  }
  if [ ! -f "$out" ]; then
    echo "browser reported success but $out does not exist (snap /tmp?)" >&2
    exit 3
  fi
  bytes=$(wc -c <"$out" | tr -d ' ')
  echo "screenshot: $out ($bytes bytes)" >&2
fi

echo "$out"

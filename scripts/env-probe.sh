#!/bin/sh
# Environment probe for NexusAgent Studio.
#
# Answers one question: **what can this machine actually do?** Every session that
# touches this project should run this first, because the answer decides which
# work is possible and which must be delegated to CI. Assuming a toolchain
# exists is how a session ends up reporting verification it never performed.
#
# POSIX sh on purpose — no bash, no Node, no Python. It has to run on a machine
# that may have none of those, which is exactly the case it exists to detect.
#
# Usage:
#   sh scripts/env-probe.sh            # full report
#   sh scripts/env-probe.sh --brief    # identity + the essentials only

set -u

BRIEF=0
[ "${1:-}" = "--brief" ] && BRIEF=1

have() { command -v "$1" >/dev/null 2>&1; }

# `timeout` is coreutils; macOS has none. Emulate with a background kill so the
# probe never hangs on a daemon that is installed but not answering.
run_limited() {
  _seconds=$1
  shift
  if have timeout; then
    timeout "$_seconds" "$@" 2>&1
    return $?
  fi
  "$@" >/tmp/env-probe.$$ 2>&1 &
  _pid=$!
  ( sleep "$_seconds"; kill "$_pid" 2>/dev/null ) &
  _killer=$!
  wait "$_pid" 2>/dev/null
  _status=$?
  kill "$_killer" 2>/dev/null
  cat /tmp/env-probe.$$ 2>/dev/null
  rm -f /tmp/env-probe.$$
  return $_status
}

version_of() {
  have "$1" || return 1
  run_limited 5 "$1" --version 2>/dev/null | head -1
}

section() { printf '\n--- %s ---\n' "$1"; }
line() { printf '  %-14s %s\n' "$1" "$2"; }

# ---------------------------------------------------------------- identity ---
HOST=$(hostname 2>/dev/null || echo unknown)
OS=$(uname -s 2>/dev/null || echo unknown)
KERNEL=$(uname -r 2>/dev/null || echo unknown)
ARCH=$(uname -m 2>/dev/null || echo unknown)
MID=$(cat /etc/machine-id 2>/dev/null | cut -c1-8)
[ -z "$MID" ] && MID="n/a"

DISTRO=""
if [ -r /etc/os-release ]; then
  DISTRO=$(grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"')
fi

CORES=$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null) | head -1)
[ -z "$CORES" ] && CORES="?"

RAM="?"
if [ -r /proc/meminfo ]; then
  RAM=$(awk '/^MemTotal:/{printf "%.1f GB", $2/1048576}' /proc/meminfo)
fi

printf '==========================================================\n'
printf ' NexusAgent Studio — environment probe\n'
printf '==========================================================\n'
printf ' host        %s\n' "$HOST"
printf ' machine-id  %s\n' "$MID"
printf ' os          %s %s %s\n' "$OS" "$KERNEL" "$ARCH"
[ -n "$DISTRO" ] && printf ' distro      %s\n' "$DISTRO"
printf ' cpu         %s core(s), %s RAM\n' "$CORES" "$RAM"

# ------------------------------------------------------------- toolchain ---
section "TOOLCHAIN (build)"

NODE=$(version_of node || true)
NPM=$(version_of npm || true)
CARGO=$(version_of cargo || true)

if [ -n "$NODE" ]; then line node "$NODE"; else line node "ABSENT"; fi
if [ -n "$NPM" ]; then line npm "$NPM"; else line npm "ABSENT"; fi
if [ -n "$CARGO" ]; then line cargo "$CARGO"; else line cargo "ABSENT"; fi

# The floor is >=22; Node 20 in apt is below it, which is a trap worth naming.
NODE_MAJOR=""
if [ -n "$NODE" ]; then
  NODE_MAJOR=$(printf '%s' "$NODE" | sed -n 's/^v\([0-9]*\).*/\1/p')
fi

CAN_BUILD=0
if [ -n "$NPM" ] && [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
  CAN_BUILD=1
fi

# --------------------------------------------------------- runtime & tools ---
if [ "$BRIEF" -eq 0 ]; then
  section "RUNTIME"
  for tool in python3 git jq curl; do
    v=$(version_of "$tool" || true)
    if [ -n "$v" ]; then line "$tool" "$v"; else line "$tool" "ABSENT"; fi
  done

  section "CONTAINERS"
  if have docker; then
    line docker "$(version_of docker || echo present)"
    if run_limited 8 docker info >/dev/null 2>&1; then
      line "daemon" "RESPONDS"
    else
      # Two very different failures, so report which one it is.
      _err=$(run_limited 8 docker info 2>&1 | tail -1)
      case "$_err" in
        *permission\ denied*) line "daemon" "DENIED (user not in 'docker' group)" ;;
        *) line "daemon" "UNREACHABLE" ;;
      esac
    fi
  else
    line docker "ABSENT"
  fi
fi

section "LOCAL MODELS"
if have ollama; then
  line ollama "$(version_of ollama || echo present)"
  _models=$(run_limited 8 ollama list 2>/dev/null | awk 'NR>1 && NF {print $1}' | head -6)
  if [ -n "$_models" ]; then
    printf '%s\n' "$_models" | while read -r m; do line "model" "$m"; done
  else
    line model "none listed"
  fi
else
  line ollama "ABSENT"
fi

if [ "$BRIEF" -eq 0 ]; then
  section "PRIVILEGES & DISPLAY"
  if sudo -n true 2>/dev/null; then
    line sudo "PASSWORDLESS"
  else
    line sudo "needs a password"
  fi
  line display "X11=${DISPLAY:-none} WAYLAND=${WAYLAND_DISPLAY:-none}"

  # A Tauri window needs the WebKitGTK runtime; without it the app cannot open
  # even when the binary is fine.
  if have ldconfig; then
    if ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1'; then
      line webkitgtk "present (app window can open)"
    else
      line webkitgtk "ABSENT (Tauri window cannot open)"
    fi
  fi
fi

# ------------------------------------------------------------- conclusion ---
section "VERDICT"

# Padded so the four verdicts line up whichever way they fall — a column of
# ragged CAN/CANNOT is harder to scan than the answer deserves.
verdict() {
  if [ "$1" = 1 ]; then printf 'CAN   '; else printf 'CANNOT'; fi
}

CAN_APP=0
if have ldconfig && ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1'; then CAN_APP=1; fi

CAN_DOCKER=0
if have docker && run_limited 8 docker info >/dev/null 2>&1; then CAN_DOCKER=1; fi

CAN_AGENT=0
if have ollama; then CAN_AGENT=1; fi

printf '  %s build the core / UI        (needs node >= 22 + npm)\n' "$(verdict $CAN_BUILD)"
printf '  %s run the packaged app       (needs the WebKitGTK runtime)\n' "$(verdict $CAN_APP)"
printf '  %s run the Docker sandbox     (needs a reachable daemon)\n' "$(verdict $CAN_DOCKER)"
printf '  %s exercise the agent         (needs ollama or another provider)\n' "$(verdict $CAN_AGENT)"

if [ "$CAN_BUILD" -eq 0 ]; then
  printf '\n  => This is NOT a build machine. GitHub Actions is the only compiler.\n'
  printf '     Do not report a lint/typecheck/test/build result you did not get.\n'
fi

printf '\n  Brief form: sh scripts/env-probe.sh --brief\n'

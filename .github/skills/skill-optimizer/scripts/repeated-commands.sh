#!/bin/sh
# Count repeated shell commands, so skill-optimizer has evidence instead of opinion.
#
# Reads ~/.bash_history by default (read-only), normalises each line to its
# command prefix, drops anything that looks like a credential, and prints the
# prefixes that appear at least N times (default 3).
#
# POSIX sh on purpose: it has to run on a machine that may have no Node, which
# is one of the two machines this project is developed on.
#
# Usage: sh repeated-commands.sh [threshold] [history-file]

set -eu

threshold=${1:-3}
history=${2:-"$HOME/.bash_history"}

case $threshold in
  *[!0-9]*)
    echo "threshold must be a number, got '$threshold'" >&2
    exit 2
    ;;
esac

if [ ! -r "$history" ]; then
  echo "no readable history at $history" >&2
  echo "pass the path as the second argument, or skip this check" >&2
  exit 1
fi

# Normalisation: keep the first two words (command + subcommand) and drop
# arguments, because `npm run test -- x` and `npm run test -- y` are the same
# habit. Sorting by that prefix surfaces habits, not one-off parameter values.
awk '
  # Credential-shaped lines are never counted and never printed.
  /KEY|TOKEN|PASSWORD|SECRET|PASSWD|_auth/ { next }
  # Skip blank lines and history markers.
  /^[[:space:]]*$/ { next }
  {
    n = split($0, w, /[[:space:]]+/)
    if (n == 0) next
    prefix = w[1]
    if (n >= 2) prefix = prefix " " w[2]
    count[prefix]++
  }
  END {
    for (p in count) printf "%d\t%s\n", count[p], p
  }
' "$history" | sort -rn | awk -F'\t' -v t="$threshold" '$1 >= t { printf "%4d  %s\n", $1, $2 }'

echo
echo "threshold: >= $threshold occurrences in $history" >&2
echo "note: a prefix seen twice is not a workflow yet; three is the bar." >&2

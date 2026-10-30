#!/usr/bin/env bash
# Keeps Glowtape's prices fresh for the whole trading day from ONE GitHub Actions run.
# GitHub's scheduler is unreliable for frequent schedules, so instead of relying on a run
# every 5 minutes, this loop updates every 5 minutes until the market closes (or the job
# nears GitHub's 6-hour limit, when the next scheduled run takes over).
set -uo pipefail

MAX_MIN=${MAX_MIN:-340}           # stop before GitHub's 6-hour job limit
STEP=${STEP:-300}                 # seconds between updates
START=$(date +%s)
REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

ny_minutes() { TZ=America/New_York date +%H:%M | awk -F: '{print $1*60+$2}'; }
ny_weekday() { TZ=America/New_York date +%u; }   # 1=Mon .. 7=Sun
market_window() {                 # 9:25 AM – 4:10 PM New York, Mon–Fri
  local m; m=$(ny_minutes); [ "$(ny_weekday)" -le 5 ] && [ "$m" -ge 565 ] && [ "$m" -le 970 ]
}

update_once() {
  rm -f prev.json
  git fetch -q --depth=1 origin data 2>/dev/null && git show origin/data:data.json > prev.json 2>/dev/null || rm -f prev.json
  if ! node scripts/update.mjs out/data.json prev.json; then echo "::warning::update failed, will retry next round"; return; fi
  [ -f out/data.json ] || return
  if [ -f prev.json ] && cmp -s out/data.json prev.json; then echo "$(date -u +%H:%M) data unchanged"; return; fi
  ( cd out && rm -rf .git && git init -q -b data \
    && git config user.name "github-actions[bot]" \
    && git config user.email "41898282+github-actions[bot]@users.noreply.github.com" \
    && git add data.json && git commit -qm "Market data $(date -u +%Y-%m-%dT%H:%MZ)" \
    && git push -fq "$REPO_URL" data ) && echo "$(date -u +%H:%M) published"
}

update_once                         # always publish once (captures the close if started late)
while market_window; do
  elapsed=$(( ($(date +%s) - START) / 60 ))
  if [ "$elapsed" -ge "$MAX_MIN" ]; then echo "Reached ${MAX_MIN} min; the next scheduled run continues."; break; fi
  now=$(date +%s); sleep $(( STEP - now % STEP + 5 ))   # wake just after each 5-minute mark
  update_once
done
echo "Market window over for now."

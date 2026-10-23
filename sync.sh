#!/bin/sh
# Sync new Hevy workouts to Garmin. Extra arguments go to `node sync.mjs sync`,
# e.g. ./sync.sh --now to skip the 2-hour wait for a workout you just finished.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # launchd and apps start with a bare PATH
export NODE_USE_ENV_PROXY=1                            # use a proxy if one is set (no effect otherwise)
mkdir -p data
out=$(node sync.mjs sync "$@" 2>&1); status=$?
printf '%s\n' "$out" | tee -a data/sync.log
exit $status

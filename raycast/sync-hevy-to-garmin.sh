#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Sync Hevy to Garmin
# @raycast.mode compact

# Optional parameters:
# @raycast.packageName Garmin
# @raycast.icon 🏋️
# @raycast.description Send new Hevy workouts to Garmin Connect.

DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
"$DIR/sync.sh" --now | tail -1

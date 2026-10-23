# hevy-sync

Sends [Hevy](https://hevyapp.com) workouts to Garmin Connect in the background,
using the engine from [hevy2garmin](https://github.com/drkostas/hevy2garmin)
(the `hevy2garmin` and `garmin-auth` npm packages). No server and no database:
it runs, syncs whatever is new, and exits. The sync record is a JSON file.

- **Merges into your watch's recording** when the watch also logged the
  session: Hevy's sets, reps and weights go into the watch activity, which
  keeps its heart rate and training load. Garmin shows exercise names on
  watch-recorded activities as "Unknown".
- **Uploads a new strength activity** when there's no watch recording, with
  heart rate from Garmin's all-day tracking when Garmin still has it (it keeps
  minute-by-minute data for a few months).
- **Never duplicates.** It uses the engine's three checks: its own record, an
  existing activity at the same start time, and an in-progress claim.
- **Waits 2 hours** after a workout ends on scheduled runs, so the watch's
  recording reaches Garmin first.

Needs Hevy Pro (for the API key) and Node.js.

## Setup

1. `npm install`
2. Put your Hevy API key (hevy.com → Settings → Developer) in `.env.local`:
   ```
   HEVY_API_KEY=your-key
   ```
3. Sign in to Garmin once, in a terminal:
   ```sh
   node sync.mjs login
   ```
   Your password goes straight to Garmin (no cloud relay) and isn't saved. The
   renewable sign-in token is saved in `data/garmin/` and lasts about a year.
4. Check: `node sync.mjs check`

## Use

```sh
node sync.mjs preview      # show what would happen, change nothing
./sync.sh                  # sync (respects the 2-hour wait)
./sync.sh --now            # sync now; a just-finished workout is only merged, never uploaded
node sync.mjs status       # what's been synced
```

It's usually run by
[garmin-dashboard](https://github.com/thebruge/garmin-dashboard)'s refresh:
at 6 am, and whenever you open the Garmin Dashboard app. The Hevy sync runs
before the Garmin pull. There's also a Raycast script command in `raycast/`
("Sync Hevy to Garmin").

## Files

| File | What it does |
|---|---|
| `sync.mjs` | The commands: login, check, preview, sync, status |
| `lib/file-store.mjs` | The engine's ledger, kept in `data/ledger.json` |
| `sync.sh` | Runs a sync with the right PATH and logs to `data/sync.log` |
| `raycast/sync-hevy-to-garmin.sh` | Raycast script command |
| `data/status.json` | Outcome of the last sync, read by garmin-dashboard to show a warning (git-ignored) |

## Privacy

`.env.local` (Hevy key) and `data/` (Garmin sign-in token, sync record, logs)
are git-ignored and stay on this machine.

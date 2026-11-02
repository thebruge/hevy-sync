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

## Where it runs

It runs on the
[garmin-dashboard](https://github.com/thebruge/garmin-dashboard) server
(CT 208), deployed alongside it at `/opt/hevy-sync` by garmin-dashboard's
`server/deploy.sh` (which also runs `npm ci`). Every refresh there runs the Hevy
sync before the Garmin pull: at 7:00 and 19:00, and when you press Refresh on the
dashboard or use the Raycast commands, which trigger the server.

**Run it in one place only.** Garmin replaces the saved sign-in token each time
it's renewed, so two copies would knock each other out, and each copy would
keep its own sync record. Its `.env.local` and `data/` live on the server only.

## Commands (on the server)

Run them inside the worker container, from the Mac. Keep the single quotes:
they stop your Mac's shell from eating the inner ones.

```sh
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/hevy-sync && node sync.mjs status"'   # what's been synced
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/hevy-sync && node sync.mjs check"'    # test the Hevy key and Garmin sign-in
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/hevy-sync && node sync.mjs preview"'  # what a sync would do, changes nothing
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/hevy-sync && node sync.mjs login"'    # sign in to Garmin again
```

`node sync.mjs sync` syncs and respects the 2-hour wait; with `--now` it skips
the wait, but a workout that ended less than 2 hours ago is only merged into a
watch recording, never uploaded, and otherwise waits for a later run. The
dashboard's Refresh does `--now`; the scheduled runs don't.

## Setup from scratch

On the Mac, then moved to the server with garmin-dashboard's
`server/deploy.sh --data`:

1. `npm install`
2. Put your Hevy API key (hevy.com → Settings → Developer) in `.env.local`:
   ```
   HEVY_API_KEY=your-key
   ```
3. Sign in to Garmin once: `node sync.mjs login`. Your password goes straight
   to Garmin (no cloud relay) and isn't saved. With two-step verification on,
   it also asks for the code Garmin emails you. The renewable sign-in token is
   saved in `data/garmin/` and lasts about a year; syncs renew it without a code.
4. Check: `node sync.mjs check`, then preview: `node sync.mjs preview`.
5. Deploy with garmin-dashboard's `server/deploy.sh --data`, then delete
   `.env.local` and `data/` here.

## Files

| File | What it does |
|---|---|
| `sync.mjs` | The commands: login, check, preview, sync, status |
| `lib/file-store.mjs` | The engine's ledger, kept in `data/ledger.json` |
| `sync.sh` | Runs a sync with the right PATH and logs to `data/sync.log` (what the server runs) |
| `data/status.json` | Outcome of the last sync, read by garmin-dashboard to show a warning (git-ignored) |
| `data/workouts.json` | Every Hevy workout with sets and muscle groups, for garmin-dashboard's Strength section (git-ignored) |

## Privacy

`.env.local` (Hevy key) and `data/` (Garmin sign-in token, sync record, logs)
are git-ignored. They live on CT 208 only.

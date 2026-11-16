# hevy-sync

Sends Hevy workouts to Garmin Connect using the `hevy2garmin` and `garmin-auth`
npm packages. It runs on the
[garmin-dashboard](https://github.com/thebruge/garmin-dashboard) server (CT 208,
`/opt/hevy-sync`), deployed by garmin-dashboard's `server/deploy.sh`. `README.md`
covers the commands, setup and files; read it before changing behaviour.

## Things to know

- `sync.mjs` holds the commands (`login`, `check`, `preview`, `sync`, `status`);
  `lib/file-store.mjs` is the engine's ledger in `data/ledger.json`; `sync.sh` is
  what the server runs.
- **Run it in one place only.** Garmin replaces the sign-in token on every
  renewal, so a second copy would break the first. `.env.local` (Hevy key) and
  `data/` (Garmin token, ledger, logs) exist only on CT 208. They're gitignored;
  never commit or print them.
- The Garmin sign-in in `data/garmin/` is also used by
  [withings-sync](https://github.com/thebruge/withings-sync).
- garmin-dashboard reads `data/status.json` (for its warnings) and
  `data/workouts.json` (for its Strength section). Keep both formats compatible,
  or change garmin-dashboard in the same release.
- Never create duplicate Garmin activities: keep the engine's three checks (the
  ledger, an existing activity at the same start time, an in-progress claim) and
  the 2-hour wait on scheduled runs.
- There's no test suite. Check changes on a copy in `$TMPDIR` with a stubbed
  `fetch`, and use `preview` on CT 208 for anything touching Garmin. Ask before
  running `sync` or `login` there.

## Changes, versions and releases

- Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Add each user-visible change under `## [Unreleased]` in `CHANGELOG.md` in the
  same commit.
- To release: move the Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, set
  the same version in `package.json`, commit as `chore(release): vX.Y.Z`, and tag
  `vX.Y.Z`.
- Changes reach CT 208 only through garmin-dashboard's `server/deploy.sh`, which
  deploys committed code. Ask before each push and deploy.

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- A network blip or Garmin outage while checking the Garmin sign-in no longer
  says the sign-in needs renewing. garmin-auth reports every failed check as
  "needs MFA / fresh SSO" but deletes the tokens only when Garmin rejects them,
  so with tokens still saved the sync now fails as "Garmin unreachable" and
  `sync.sh` retries it.

## [0.2.0] - 2026-10-23

### Added
- `data/workouts.json`: every Hevy workout with its sets and each exercise's
  muscle groups, saved on each sync for garmin-dashboard's Strength section.

### Fixed
- Temporary errors (network trouble, HTTP 429/5xx, including Garmin uploads)
  get up to 3 retries after 5, 15 and 30 seconds before a sync counts as failed, and the error names the cause and host instead of just "fetch failed".

### Removed
- The local Raycast command (`raycast/`). garmin-dashboard's "Sync Hevy to Garmin"
  triggers the server instead.

### Fixed
- README: setup and commands are for the server (inside the worker container),
  with working quoting for the ssh commands.

### Changed
- Runs on the garmin-dashboard server (CT 208), deployed by garmin-dashboard's
  `server/deploy.sh`. The Garmin sign-in and sync record live there only.

### Added
- `data/status.json` records each sync's outcome, including when a new
  Garmin sign-in is needed, for garmin-dashboard's warning banner.

## [0.1.1] - 2026-10-22

### Changed
- Workout times in the output use 24-hour time.

## [0.1.0] - 2026-10-22

### Added
- `sync.mjs` with `login`, `check`, `preview`, `sync` and `status`, built on
  the `hevy2garmin` 0.15 and `garmin-auth` 0.8 npm packages.
- Garmin sign-in runs on this machine (`garmin-auth/sso-local`), and the
  token is stored in `data/garmin/`.
- A file-based sync ledger (`lib/file-store.mjs`) that implements the engine's
  `SyncStore`, including in-flight checkpoints and merge and heart-rate
  backups.
- Merges into watch-recorded strength activities, and uploads with heart rate
  from Garmin's all-day data when there's no watch recording.
- A 2-hour wait on scheduled runs. `--now` skips it, but a just-finished
  workout is only ever merged, so it can't be duplicated.
- `preview` shows the plan for every unsynced workout without changing
  anything.
- `sync.sh` for schedulers, and a Raycast script command.

[Unreleased]: https://github.com/thebruge/hevy-sync/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/thebruge/hevy-sync/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/thebruge/hevy-sync/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thebruge/hevy-sync/releases/tag/v0.1.0

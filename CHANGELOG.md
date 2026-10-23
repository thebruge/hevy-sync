# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/thebruge/hevy-sync/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/thebruge/hevy-sync/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thebruge/hevy-sync/releases/tag/v0.1.0

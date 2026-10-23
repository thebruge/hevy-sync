// The sync engine's ledger, kept in one JSON file instead of a database.
//
// hevy2garmin's engine talks to storage only through its SyncStore interface
// (node_modules/hevy2garmin/dist/sync/store.d.ts). This implements it over
// data/ledger.json: which Hevy workouts are synced, which are mid-upload, and
// the merge and heart-rate backups the engine keeps so a crash never loses data.
// Every write goes to a temp file first and is then renamed into place, so a
// crash mid-write can't corrupt the ledger.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const EMPTY = () => ({
  synced: {},        // hevyId -> { garminActivityId, title, syncMethod, synced_at, ... }
  pending: {},       // hevyId -> PendingRecord (in-flight upload checkpoint)
  mergeBackups: {},  // garmin activityId -> exercise sets before a merge
  mergeFailures: 0,
  hrBackups: {},     // hevyId -> heart-rate samples
  hrCache: {},
  log: [],           // one row per run
});

export class FileStore {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = { ...EMPTY(), ...(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}) };
  }

  save() {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db, null, 1), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  now() { return new Date().toISOString(); }

  // ---- dedup reads ----
  async isSynced(id) { return id in this.db.synced; }
  async loadSyncedIds() { return new Set(Object.keys(this.db.synced)); }
  async loadPendingIds() { return new Set(Object.keys(this.db.pending)); }
  async getPending(id) { return this.db.pending[id] ?? null; }

  // ---- in-flight checkpoints ----
  async claimPending(id, payload) {
    if (this.db.pending[id]) return false;
    const t = this.now();
    this.db.pending[id] = {
      hevy_id: id, phase: "claimed", next_step: null, upload_id: null,
      garmin_activity_id: null, watch_activity_id: null, pre_upload_ids: [],
      payload: payload ?? {}, resolution_source: null, attempt_count: 0,
      delete_attempt_count: 0, last_error: null, locked_until: null,
      created_at: t, updated_at: t,
    };
    this.save();
    return true;
  }
  async updatePending(id, fields) {
    if (!this.db.pending[id]) return;
    Object.assign(this.db.pending[id], fields, { updated_at: this.now() });
    this.save();
  }
  async deletePending(id) {
    const had = id in this.db.pending;
    delete this.db.pending[id];
    if (had) this.save();
    return had;
  }
  async completePending(id, opts) {
    this.#mark(id, opts);
    delete this.db.pending[id];
    this.save();
  }

  // ---- terminal rows ----
  async markSynced(id, opts) { this.#mark(id, opts); this.save(); }
  #mark(id, opts = {}) {
    const prev = this.db.synced[id];
    const t = this.now();
    this.db.synced[id] = {
      ...prev, ...opts, status: "success",
      synced_at: opts.resync && prev?.synced_at ? prev.synced_at : t,
      ...(opts.resync ? { resynced_at: t } : {}),
    };
    delete this.db.synced[id].resync;
  }
  /** Record a workout as handled without uploading (used for manual skips). */
  markSkipped(id, title) {
    this.db.synced[id] = { status: "skipped", title, synced_at: this.now() };
    this.save();
  }

  // ---- run log ----
  async recordSyncLog(entry) {
    this.db.log.push({ ...entry, at: this.now() });
    this.db.log = this.db.log.slice(-200);
    this.save();
  }

  // ---- merge safety ----
  async loadMergeBackup(activityId) { return this.db.mergeBackups[activityId] ?? null; }
  async saveMergeBackup(activityId, sets) { this.db.mergeBackups[activityId] = sets; this.save(); }
  async clearMergeBackup(activityId) { delete this.db.mergeBackups[activityId]; this.save(); }
  async loadMergeFailures() { return this.db.mergeFailures || 0; }
  async saveMergeFailures(n) { this.db.mergeFailures = n; this.save(); }

  // ---- heart-rate backups (handed to the engine as HrDeps) ----
  hrDeps() {
    return {
      loadBackup: async id => this.db.hrBackups[id] ?? null,
      saveBackup: async (id, samples) => { this.db.hrBackups[id] = samples; this.save(); },
      cachedHr: async id => this.db.hrCache[id] ?? null,
      saveCache: async (id, samples) => { this.db.hrCache[id] = samples; this.save(); },
    };
  }
}

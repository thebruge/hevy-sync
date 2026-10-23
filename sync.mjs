#!/usr/bin/env node
// Sync Hevy workouts to Garmin Connect, using the hevy2garmin engine.
//
//   node sync.mjs login            sign in to Garmin once (asks in the terminal)
//   node sync.mjs check            test the Hevy key and the Garmin sign-in
//   node sync.mjs preview          show what a sync would do, change nothing
//   node sync.mjs sync             sync everything not yet on Garmin
//        --now                     don't wait out the 2-hour grace period
//        --limit N                 stop after N workouts
//   node sync.mjs status           what's been synced so far
//
// Exit codes: 0 ok, 1 something failed, 2 Garmin sign-in needed.
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HevyClient, garminGateway, listCandidates, syncOneWorkout, reconcilePending,
  findMergeMatch, mergeSearchRange, dailyHrToPoints, DEFAULT_GRACE_MINUTES,
} from "hevy2garmin";
import { GarminAuth, FileTokenStore } from "garmin-auth";
import { createLocalSsoClient } from "garmin-auth/sso-local";
import { tokensFromResult } from "garmin-auth/sso-worker";
import { FileStore } from "./lib/file-store.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const TOKENS_DIR = join(DATA, "garmin");
const LEDGER = join(DATA, "ledger.json");
const PROFILE_CACHE = join(DATA, "profile.json");
const LOCK = join(DATA, ".sync.lock");

// The merge choice from setup: fold Hevy's sets into the watch's own strength
// activity, keeping its heart rate and training load.
const MERGE = { enabled: true, watchStrategy: "merge", activityTypes: ["strength_training"] };

// ---------- small helpers ----------
const args = process.argv.slice(2);
const cmd = args[0] || "sync";
const flag = name => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const day = s => String(s || "").slice(0, 10);
const fmtWhen = iso => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "?";

function env() {
  const out = {};
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function hevyClient() {
  const key = env().HEVY_API_KEY;
  if (!key) fail(`HEVY_API_KEY is empty in ${join(ROOT, ".env.local")}. Paste your Hevy key after the = and save.`);
  return new HevyClient(key);
}

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = s => { if (!s.includes(question)) return; rl.output.write(s); };
    }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

async function garminClient() {
  if (!existsSync(join(TOKENS_DIR))) fail("Not signed in to Garmin yet. Run: node sync.mjs login", 2);
  try {
    return await new GarminAuth({ store: new FileTokenStore(TOKENS_DIR) }).client();
  } catch (e) {
    fail(`Garmin sign-in needs renewing (${e.message}). Run: node sync.mjs login`, 2);
  }
}

// Workouts from Hevy, newest first, fetched once per run.
function workoutSource(hevy) {
  let cached = null;
  return async () => {
    if (!cached) {
      cached = await hevy.getAllWorkouts();
      cached.sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
    }
    return cached;
  };
}

// Weight, birth year and VO2 max make the calorie estimate right. Read from
// Garmin once a week; if that fails, the engine's defaults are used.
async function profile(client) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    if (existsSync(PROFILE_CACHE) && Date.now() - statSync(PROFILE_CACHE).mtimeMs < 7 * 864e5)
      return { ...JSON.parse(readFileSync(PROFILE_CACHE, "utf8")), timezone: tz };
    const p = await client.connectapi("/userprofile-service/userprofile/personal-information");
    const bio = p?.biometricProfile || {}, info = p?.userInfo || {};
    const out = {};
    if (bio.weight) out.weightKg = Math.round(bio.weight / 100) / 10;   // grams -> kg
    if (bio.vo2Max) out.vo2max = bio.vo2Max;
    if (info.birthDate) out.birthYear = Number(String(info.birthDate).slice(0, 4));
    writeFileSync(PROFILE_CACHE, JSON.stringify(out), { mode: 0o600 });
    return { ...out, timezone: tz };
  } catch {
    return { timezone: tz };
  }
}

function deps(store, hevy, client) {
  let gw = null;
  const gateway = async () => (gw ??= garminGateway(client));
  return {
    store,
    gateway,
    fetchWorkouts: workoutSource(hevy),
    hr: {
      ...store.hrDeps(),
      // Garmin's all-day wrist heart rate, for workouts the watch didn't record.
      dailyHr: async (start, end) => {
        const g = await gateway();
        if (!g.dailyHeartRate) return null;
        const d = new Date(start.getTime() - start.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
        return dailyHrToPoints(await g.dailyHeartRate(d), start, end);
      },
    },
  };
}

// One run at a time (the 6 am schedule and a manual trigger could overlap).
function lock() {
  mkdirSync(DATA, { recursive: true });
  try { mkdirSync(LOCK); }
  catch {
    if (Date.now() - statSync(LOCK).mtimeMs < 30 * 6e4) fail("A sync is already running.", 0);
    rmdirSync(LOCK); mkdirSync(LOCK);
  }
  const release = () => { try { rmdirSync(LOCK); } catch {} };
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(130));
}

// ---------- commands ----------
async function login() {
  console.log("Sign in to Garmin Connect. Your password goes straight to Garmin and is not saved.\n");
  const email = await ask("Garmin email: ");
  const password = await ask("Garmin password: ", { hidden: true });
  const sso = createLocalSsoClient();
  let r = await sso.login(email, password);
  if (r.status === "needs_mfa") {
    const code = await ask(`Verification code (sent by ${r.mfa_method || "email"}): `);
    r = await sso.loginMfa(r.session_id, code);
  }
  const tokens = r.status === "success" ? tokensFromResult(r) : null;
  if (!tokens) {
    const why = { invalid_credentials: "wrong email or password", rate_limited: `too many attempts, try again in ${r.retry_after_seconds || 60}s`, needs_captcha: "Garmin wants a captcha; sign in at connect.garmin.com in a browser, then try again" }[r.status];
    fail(`Sign-in failed: ${why || r.message || r.status}`);
  }
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
  await new FileTokenStore(TOKENS_DIR).save(tokens);
  const client = await garminClient();
  const me = await client.connectapi("/userprofile-service/socialProfile").catch(() => null);
  console.log(`Signed in${me?.displayName ? ` as ${me.fullName || me.displayName}` : ""}. The sign-in renews itself; you won't need to do this again for about a year.`);
}

async function check() {
  const hevy = hevyClient();
  const n = await hevy.getWorkoutCount().catch(e => fail(`Hevy key rejected (${e.message}). Check HEVY_API_KEY in .env.local.`));
  console.log(`Hevy: connected, ${n} workouts.`);
  const client = await garminClient();
  const me = await client.connectapi("/userprofile-service/socialProfile").catch(e => fail(`Garmin: ${e.message}`));
  console.log(`Garmin: signed in${me?.displayName ? ` as ${me.fullName || me.displayName}` : ""}.`);
}

async function preview() {
  const store = new FileStore(LEDGER);
  const hevy = hevyClient();
  const client = await garminClient();
  const d = deps(store, hevy, client);
  const all = await d.fetchWorkouts();
  const byId = new Map(all.map(w => [w.id, w]));
  const candidates = (await listCandidates(d)).reverse();          // oldest first
  console.log(`${all.length} Hevy workouts, ${all.length - candidates.length} already synced, ${candidates.length} to sync.\n`);
  const g = await d.gateway();
  const counts = { merge: 0, upload: 0, already: 0, wait: 0 };
  for (const [i, c] of candidates.entries()) {
    const w = byId.get(c.hevy_id) || c;
    let plan;
    const ended = w.end_time ? (Date.now() - Date.parse(w.end_time)) / 6e4 : Infinity;
    // Same order as the engine: try a merge first, then the start-time match, then upload.
    const range = mergeSearchRange(w);
    const acts = range ? await g.activitiesByDate(range.start, range.end).catch(() => []) : [];
    const m = findMergeMatch(w, acts, { activityTypes: MERGE.activityTypes });
    const existing = m ? null : await g.findExistingActivity(w.start_time).catch(() => null);
    if (m) {
      const drift = Math.round(m.driftMinutes);
      plan = `merge into watch "${m.activity.activityName || m.activity.activityId}" (${Math.round(m.overlapPct * 100)}% overlap, ${drift} min apart)`;
      counts.merge++;
    } else if (existing) {
      plan = `already on Garmin (activity ${existing}): rename and add description`;
      counts.already++;
    } else {
      plan = "upload as a new strength activity";
      counts.upload++;
      const same = acts.filter(a => day(a.startTimeLocal) === day(new Date(Date.parse(w.start_time) - new Date(w.start_time).getTimezoneOffset() * 6e4).toISOString()));
      if (same.length) plan += `\n       Garmin that day: ` + same.map(a => `${a.activityType?.typeKey} ${String(a.startTimeLocal).slice(11, 16)} ${Math.round((a.duration || 0) / 60)}min`).join("; ");
    }
    if (ended < DEFAULT_GRACE_MINUTES) { plan += `, after the 2-hour wait (ended ${Math.round(ended)} min ago)`; counts.wait++; }
    console.log(`${String(i + 1).padStart(3)}. ${fmtWhen(w.start_time)}  ${(w.title || "Workout").slice(0, 32).padEnd(32)}  ${plan}`);
  }
  console.log(`\nPlan: ${counts.merge} merge into watch activities, ${counts.upload} new uploads, ${counts.already} already on Garmin.` +
    (counts.wait ? ` ${counts.wait} still inside the 2-hour wait.` : "") + "\nNothing was changed.");
}

async function sync() {
  lock();
  const now = flag("--now");
  const limit = Number(opt("--limit", "100000"));
  const store = new FileStore(LEDGER);
  const hevy = hevyClient();
  const client = await garminClient();
  const d = deps(store, hevy, client);
  const prof = await profile(client);

  // Finish any upload a previous run left half-done, before anything new.
  for (const id of await store.loadPendingIds()) {
    const r = await reconcilePending(d, id).catch(e => ({ status: "error", error: e.message }));
    console.log(`Resumed an interrupted upload (${id}): ${r.status}${r.error ? ` – ${r.error}` : ""}`);
  }

  const all = await d.fetchWorkouts();
  const byId = new Map(all.map(w => [w.id, w]));
  const candidates = (await listCandidates(d)).reverse().slice(0, limit);   // oldest first
  const tally = { synced: 0, skipped: 0, failed: 0 };
  let waiting = 0;
  for (const c of candidates) {
    const w = byId.get(c.hevy_id) || c;
    // A manual run (--now) skips the 2-hour wait, but for a workout that ended
    // inside it, only merges: if the watch recording hasn't reached Garmin yet,
    // uploading now would create a duplicate, so it waits for a later run.
    const fresh = w.end_time && (Date.now() - Date.parse(w.end_time)) / 6e4 < DEFAULT_GRACE_MINUTES;
    const r = await syncOneWorkout(d, {
      dryRun: false, targetHevyId: c.hevy_id, respectGrace: !now,
      mergeOnly: now && Boolean(fresh),
      merge: MERGE, hrFusion: true, profile: prof,
    }).catch(e => ({ status: "error", error: e.message }));
    const label = `${fmtWhen(w.start_time)}  ${w.title || "Workout"}`;
    if (r.status === "synced") {
      tally.synced++;
      const how = r.syncMethod === "merge" ? `merged into watch activity (${r.setsPushed ?? "?"} sets)` : r.syncMethod === "match" ? "already on Garmin, linked" : "uploaded";
      console.log(`✓ ${label}: ${how}`);
    } else if (r.status === "deferred" || r.dedupDecision === "within_grace" || r.status === "merge_pending") {
      waiting++;
      console.log(`… ${label}: waiting for the watch upload (2-hour grace period)`);
    } else if (r.status === "skipped" || r.status === "none") {
      tally.skipped++;
      console.log(`- ${label}: skipped (${r.dedupDecision})`);
    } else {
      tally.failed++;
      console.log(`✗ ${label}: ${r.status}${r.error ? ` – ${r.error}` : ""}`);
      if (/auth|401|sign.?in/i.test(r.error || "")) break;
    }
  }
  await store.recordSyncLog({ ...tally, trigger: now ? "manual" : "scheduled" });
  const parts = [];
  if (tally.synced) parts.push(`${tally.synced} synced`);
  if (waiting) parts.push(`${waiting} waiting`);
  if (tally.failed) parts.push(`${tally.failed} failed`);
  console.log(parts.length ? `Hevy → Garmin: ${parts.join(", ")}` : "Hevy → Garmin: nothing new");
  if (tally.failed) process.exitCode = 1;
}

function status() {
  const store = new FileStore(LEDGER);
  const synced = Object.values(store.db.synced);
  const by = k => synced.filter(s => s.syncMethod === k).length;
  console.log(`Synced: ${synced.length} workouts (${by("merge")} merged, ${by("upload")} uploaded, ${by("match")} already on Garmin).`);
  const pend = Object.keys(store.db.pending).length;
  if (pend) console.log(`Interrupted uploads waiting to resume: ${pend}`);
  const last = store.db.log.at(-1);
  console.log(last ? `Last run: ${fmtWhen(last.at)} (${last.trigger}): ${last.synced} synced, ${last.failed} failed.` : "No runs yet.");
  console.log(`Garmin sign-in: ${existsSync(TOKENS_DIR) ? "saved" : "not set up (run: node sync.mjs login)"}`);
}

const commands = { login, check, preview, sync, status };
if (!commands[cmd]) fail(`Unknown command "${cmd}". Use: login, check, preview, sync, status`);
await commands[cmd]();

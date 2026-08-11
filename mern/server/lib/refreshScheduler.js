// Schedules re-runs of scrape-upcoming-term.mjs, so the shared schedule tracks
// UCSD without anyone remembering to run a script.
//
// This is the admin's replacement for the old chore. Before the Class Planner
// migration, "refreshing the schedule" meant an admin signing into TSS and
// publishing a capture by hand, as often as they could stand to. Now the data
// is public, so freshness is just a cadence decision — and the cadence is the
// admin's to set (Admin → Section data), stored in refresh-config.json beside
// the snapshot it governs.
//
// Design notes:
//   - The scraper stays a standalone script; this spawns it rather than
//     importing it, so there is exactly one implementation of the scrape and
//     a wedged run can be killed without taking the server down.
//   - intervalHours = 0 means manual-only (the Refresh now button still works).
//   - Runs are serialized: a trigger while one is in flight reports "already
//     running" instead of stacking a second scrape onto UCSD.
//   - On boot, a snapshot older than the interval triggers a catch-up run —
//     a redeploy after a quiet week should not serve week-old structure.
//   - Failures back off exponentially. A failed run leaves the snapshot's age
//     untouched, so "time remaining in the interval" stays negative and the
//     retry pins to its 30s floor forever; without backoff a broken scraper
//     queries UCSD every ~33 seconds until someone notices.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..");
const scriptPath = path.join(serverRoot, "scripts", "scrape-upcoming-term.mjs");
const snapshotPath = path.join(serverRoot, "scripts", "data", "upcoming-term.json");
const configPath = path.join(serverRoot, "scripts", "data", "refresh-config.json");

const DEFAULT_INTERVAL_HOURS = 24;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const BOOT_DELAY_MS = 30 * 1000; // let the server settle before a catch-up run

let intervalHours = DEFAULT_INTERVAL_HOURS;
let timer = null;
let running = false;
let lastRun = null; // { at, ok, error, durationMs, output }
let onRefreshed = () => {};
// Consecutive failures, for backoff. See scheduleNext().
let failures = 0;

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (Number.isFinite(cfg.intervalHours) && cfg.intervalHours >= 0) {
      intervalHours = cfg.intervalHours;
    }
  } catch {
    intervalHours = DEFAULT_INTERVAL_HOURS;
  }
}

function saveConfig() {
  fs.writeFileSync(
    configPath,
    JSON.stringify({ intervalHours, updatedAt: new Date().toISOString() }, null, 1),
  );
}

function snapshotAgeMs() {
  try {
    const { scraped_at } = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    const t = new Date(scraped_at).getTime();
    return Number.isFinite(t) ? Date.now() - t : Infinity;
  } catch {
    return Infinity; // no snapshot: maximally stale
  }
}

/**
 * How long until the next automatic run.
 *
 * Normally: whatever is left of the configured interval since the snapshot was
 * written, with a floor so a boot does not scrape instantly.
 *
 * After a failure: exponential backoff instead. This matters because a failed
 * run never updates the snapshot, so `interval - snapshotAge` stays negative
 * forever and pins to the floor — a scraper failing persistently (UCSD down,
 * schema change, network block) re-ran every ~33 seconds indefinitely, which is
 * a good way to get the deploy's IP blocked by the very API we depend on.
 * Backoff doubles from the floor and is capped at the configured interval, so
 * the worst case degrades to the normal cadence rather than a hammer.
 */
export function backoffMs(consecutiveFailures, intervalMs, floorMs = BOOT_DELAY_MS) {
  const backoff = floorMs * 2 ** (Math.max(1, consecutiveFailures) - 1);
  return Math.min(backoff, Math.max(intervalMs, floorMs));
}

function dueInMs() {
  if (!intervalHours) return null; // manual-only
  const interval = intervalHours * 3600 * 1000;
  if (failures > 0) return backoffMs(failures, interval);
  return Math.max(interval - snapshotAgeMs(), BOOT_DELAY_MS);
}

export function nextRunAt() {
  const due = dueInMs();
  return due === null ? null : new Date(Date.now() + due).toISOString();
}

/**
 * Run the scraper once. Resolves to lastRun; never rejects. Concurrent calls
 * get { ok: false, error: "already running" } without starting a second run.
 */
export function runRefresh() {
  if (running) {
    return Promise.resolve({ ok: false, error: "A refresh is already running." });
  }
  running = true;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: serverRoot });
    let output = "";
    const absorb = (buf) => {
      output = (output + buf.toString()).slice(-4000); // keep the tail
    };
    child.stdout.on("data", absorb);
    child.stderr.on("data", absorb);

    const killTimer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(killTimer);
      running = false;
      lastRun = {
        at: new Date(startedAt).toISOString(),
        ok: code === 0,
        error: code === 0 ? null : `scraper exited with code ${code}`,
        durationMs: Date.now() - startedAt,
        output: output.trim().split("\n").slice(-6).join("\n"),
      };
      if (code === 0) {
        try {
          onRefreshed();
        } catch (err) {
          lastRun.ok = false;
          lastRun.error = `scrape succeeded but reload failed: ${err.message}`;
        }
      }
      // A run that produced no usable snapshot counts as a failure for backoff,
      // including the "scraped fine but reload threw" case — that one leaves the
      // route serving the old data too, so retrying hard helps nobody.
      if (lastRun.ok) failures = 0;
      else failures += 1;
      schedule(); // next run counts from this one
      resolve(lastRun);
    });
  });
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const dueIn = dueInMs();
  if (dueIn === null) return;
  timer = setTimeout(runRefresh, dueIn);
  timer.unref?.(); // never keep the process alive just for this
}

export function getStatus() {
  return {
    intervalHours,
    running,
    lastRun,
    consecutiveFailures: failures,
    backingOff: failures > 0,
    nextRunAt: nextRunAt(),
    snapshotAgeMs: snapshotAgeMs(),
  };
}

export function setIntervalHours(hours) {
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30) {
    throw new Error("intervalHours must be a number between 0 (manual) and 720.");
  }
  intervalHours = hours;
  // An admin changing the cadence is an explicit "try again now" — don't make
  // them wait out a backoff they may have just fixed the cause of.
  failures = 0;
  saveConfig();
  schedule();
  return getStatus();
}

/** Wire up and start. `callbacks.onRefreshed` re-reads the snapshot into the route. */
export function init(callbacks = {}) {
  onRefreshed = callbacks.onRefreshed || onRefreshed;
  loadConfig();
  schedule();
}

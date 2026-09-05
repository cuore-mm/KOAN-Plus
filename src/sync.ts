export type SyncTarget = "dashboard" | "reference" | "grades";
export const SYNC_STATE_KEY = "koan-plus-sync-state-v1";
export const MANUAL_REFRESH_TTL_MS = 60 * 1000;
export const GRADES_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

type Attempt = { retryAt: number; failures: number };
let memory: Partial<Record<SyncTarget, Attempt>> = {};
let running = false;
let storageWriteFailed = false;

export function isSyncFresh(value: string | null | undefined, ttl: number, now = Date.now()) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < ttl;
}

function readState() {
  if (storageWriteFailed) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* Keep the in-memory retry guard when storage is unavailable. */ }
  return memory;
}

function readAttempt(target: SyncTarget): Attempt {
  const value = readState()[target];
  return {
    retryAt: Number.isFinite(value?.retryAt) ? value.retryAt : 0,
    failures: Number.isFinite(value?.failures) ? Math.max(0, value.failures) : 0,
  };
}

export function syncRetryAt(target: SyncTarget) {
  return readAttempt(target).retryAt;
}

function writeAttempt(target: SyncTarget, value: Attempt) {
  memory = { ...readState(), [target]: value };
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(memory));
    storageWriteFailed = false;
  } catch { storageWriteFailed = true; }
}

export function startSyncAttempt(target: SyncTarget) {
  writeAttempt(target, { ...readAttempt(target), retryAt: Date.now() + MANUAL_REFRESH_TTL_MS });
}

export function finishSyncAttempt(target: SyncTarget, succeeded: boolean) {
  const failures = succeeded ? 0 : readAttempt(target).failures + 1;
  const delay = MANUAL_REFRESH_TTL_MS * 2 ** Math.min(failures, 6);
  writeAttempt(target, { failures, retryAt: Date.now() + delay });
}

/** One writer across extension tabs; never queue stale closures behind a long crawl.
 * The losing tab reads shared cache and retries from its current state later.
 * Existing resource leases remain the fallback where Web Locks are unavailable.
 */
export async function coordinateSync(task: () => Promise<void>): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("koan-plus-sync", { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        await task();
        return true;
      });
    }
    await task();
    return true;
  } finally {
    running = false;
  }
}

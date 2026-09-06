import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isKoanCacheFresh, type KoanData } from "./koan";
import { EMPTY_CLE_DATA, isCleCacheFresh } from "./cle";

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("sync coordination", () => {
  it("does not run work when another tab owns the lock", async () => {
    vi.stubGlobal("navigator", { locks: { request: (_: string, __: unknown, callback: (lock: null) => unknown) => callback(null) } });
    const { coordinateSync } = await import("./sync");
    const work = vi.fn();
    expect(await coordinateSync(work)).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("coalesces overlapping work and releases the gate after failures", async () => {
    vi.stubGlobal("navigator", {});
    const { coordinateSync } = await import("./sync");
    let release!: () => void;
    const first = coordinateSync(() => new Promise<void>((resolve) => { release = resolve; }));
    const work = vi.fn();
    expect(await coordinateSync(work)).toBe(false);
    expect(work).not.toHaveBeenCalled();
    release();
    expect(await first).toBe(true);
    await expect(coordinateSync(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await coordinateSync(work)).toBe(true);
  });

  it("backs off authentication failures across reloads, and resets after success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
    const sync = await import("./sync");
    sync.startSyncAttempt("grades");
    sync.finishSyncAttempt("grades", false);
    expect(sync.syncRetryAt("grades") - Date.now()).toBe(120_000);
    vi.resetModules();
    const reloaded = await import("./sync");
    expect(reloaded.syncRetryAt("grades")).toBe(sync.syncRetryAt("grades"));
    reloaded.finishSyncAttempt("grades", false);
    expect(reloaded.syncRetryAt("grades") - Date.now()).toBe(240_000);
    reloaded.finishSyncAttempt("grades", true);
    expect(reloaded.syncRetryAt("grades") - Date.now()).toBe(60_000);
  });

  it("retains the retry guard when storage reads work but writes fail", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
    const sync = await import("./sync");
    sync.startSyncAttempt("grades");
    expect(sync.syncRetryAt("grades")).toBeGreaterThan(Date.now());
    sync.finishSyncAttempt("grades", false);
    expect(sync.syncRetryAt("grades") - Date.now()).toBeGreaterThan(119_000);
  });

  it("expires at the boundary and rejects future and invalid timestamps", async () => {
    const { isSyncFresh } = await import("./sync");
    const now = Date.now();
    expect(isSyncFresh(new Date(now - 59_999).toISOString(), 60_000, now)).toBe(true);
    expect(isSyncFresh(new Date(now - 60_000).toISOString(), 60_000, now)).toBe(false);
    expect(isSyncFresh(new Date(now + 1).toISOString(), 60_000, now)).toBe(false);
    expect(isSyncFresh("invalid", 60_000, now)).toBe(false);
  });
});

it("manual refresh checks recent data without expiring long-lived course caches", () => {
  const recent = new Date(Date.now() - 120_000).toISOString();
  const koan: KoanData = {
    schedule: [], courses: [], changes: [], surveys: [], notices: [],
    lightUpdatedAt: recent, snapshotUpdatedAt: recent, scheduleUpdatedAt: recent,
    futureScheduleUpdatedAt: recent, coursesUpdatedAt: recent, changesUpdatedAt: recent,
    futureChangesUpdatedAt: recent, surveysUpdatedAt: recent, noticesUpdatedAt: recent,
  };
  expect(isKoanCacheFresh(koan)).toBe(true);
  expect(isKoanCacheFresh(koan, true)).toBe(false);
  expect(isKoanCacheFresh({ ...koan, changesUpdatedAt: new Date().toISOString(), noticesUpdatedAt: new Date().toISOString() }, true)).toBe(true);
  const cle = { ...EMPTY_CLE_DATA, taskScopeVersion: 3, coursesUpdatedAt: recent, tasksUpdatedAt: recent, messagesUpdatedAt: recent, taskStatusesUpdatedAt: recent };
  expect(isCleCacheFresh(cle)).toBe(true);
  expect(isCleCacheFresh(cle, true)).toBe(false);
});

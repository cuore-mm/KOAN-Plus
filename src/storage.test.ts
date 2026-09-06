import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLE_CACHE_KEY,
  CLE_MATERIALS_CACHE_KEY,
  KOAN_CACHE_KEY,
  ONBOARDING_KEY,
  THEME_KEY,
  clearAllStoredData,
  clearCacheStorage,
  clearStorageDiagnostics,
  exportCacheJson,
  getStorageDiagnostics,
  getStorageUsage,
  listManagedStorageKeys,
  loadCache,
  saveCache,
  saveOnboardingRecord,
  saveOnboardingRecordResult,
} from "./storage";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let setFailure: unknown = null;
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] || null;
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (setFailure) throw setFailure;
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
  } as Storage;
  vi.stubGlobal("localStorage", storage);
  return {
    values,
    failWrites(error: unknown) {
      setFailure = error;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearStorageDiagnostics();
});

describe("safe cache persistence", () => {
  it("returns null and records a diagnostic for malformed JSON", () => {
    stubLocalStorage({ [KOAN_CACHE_KEY]: "{broken" });

    expect(loadCache()).toBeNull();
    const recorded = getStorageDiagnostics();
    expect(recorded[recorded.length - 1]).toMatchObject({
      key: KOAN_CACHE_KEY,
      kind: "parse",
    });
  });

  it("keeps the previous value when JSON serialization fails", () => {
    const { values } = stubLocalStorage({ [KOAN_CACHE_KEY]: '{"old":true}' });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const result = saveCache(circular);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("serialize");
    expect(values.get(KOAN_CACHE_KEY)).toBe('{"old":true}');
  });

  it("keeps the previous value and exposes quota failures", () => {
    const fake = stubLocalStorage({ [KOAN_CACHE_KEY]: '{"old":true}' });
    const quotaError = Object.assign(new Error("storage full"), {
      name: "QuotaExceededError",
    });
    fake.failWrites(quotaError);

    const result = saveCache({ replacement: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("quota");
    expect(fake.values.get(KOAN_CACHE_KEY)).toBe('{"old":true}');
  });

  it("returns a failed onboarding result instead of claiming consent was saved", () => {
    const fake = stubLocalStorage();
    fake.failWrites(Object.assign(new Error("storage blocked"), { name: "SecurityError" }));

    const result = saveOnboardingRecordResult();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("write");
    expect(saveOnboardingRecord()).toBeNull();
  });
});

describe("cache maintenance", () => {
  it("lists and clears legacy and dynamic notice-attempt keys", () => {
    const fake = stubLocalStorage({
      [KOAN_CACHE_KEY]: "{}",
      "koan-plus-cache-v2": "{}",
      "koan-plus-notice-resolve-attempt-v1:/notice?id=1": "1",
      [THEME_KEY]: "dark",
      [ONBOARDING_KEY]: "{}",
      unrelated: "keep",
    });

    expect(listManagedStorageKeys()).toEqual(expect.arrayContaining([
      KOAN_CACHE_KEY,
      "koan-plus-cache-v2",
      "koan-plus-notice-resolve-attempt-v1:/notice?id=1",
      THEME_KEY,
      ONBOARDING_KEY,
    ]));

    const result = clearCacheStorage();

    expect(result.ok).toBe(true);
    expect(fake.values.has(KOAN_CACHE_KEY)).toBe(false);
    expect(fake.values.has("koan-plus-cache-v2")).toBe(false);
    expect(fake.values.has("koan-plus-notice-resolve-attempt-v1:/notice?id=1")).toBe(false);
    expect(fake.values.get(THEME_KEY)).toBe("dark");
    expect(fake.values.get(ONBOARDING_KEY)).toBe("{}");
    expect(fake.values.get("unrelated")).toBe("keep");

    clearAllStoredData();
    expect(fake.values.has(THEME_KEY)).toBe(false);
    expect(fake.values.has(ONBOARDING_KEY)).toBe(false);
  });

  it("reports per-key and total storage size without writing", () => {
    stubLocalStorage({
      [KOAN_CACHE_KEY]: "あいう",
      [CLE_CACHE_KEY]: JSON.stringify({ tasks: [] }),
      [CLE_MATERIALS_CACHE_KEY]: "{}",
    });

    const usage = getStorageUsage();

    expect(usage.ok).toBe(true);
    expect(usage.totalCharacters).toBeGreaterThan(0);
    expect(usage.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: KOAN_CACHE_KEY, managed: true }),
      expect.objectContaining({ key: CLE_CACHE_KEY, managed: true }),
    ]));
  });

  it("exports current JSON caches without exporting preferences", () => {
    stubLocalStorage({
      [KOAN_CACHE_KEY]: JSON.stringify({ notices: [] }),
      [THEME_KEY]: "dark",
    });

    const result = exportCacheJson();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.parse(result.json) as {
        entries: Record<string, unknown>;
      };
      expect(payload.entries[KOAN_CACHE_KEY]).toEqual({ notices: [] });
      expect(payload.entries[THEME_KEY]).toBeUndefined();
      expect(result.bytes).toBeGreaterThan(0);
    }
  });
});

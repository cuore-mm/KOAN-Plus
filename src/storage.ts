// The class-change date parser changed to trust KOAN's table headers. Do not
// reuse cached records produced by the previous date reconstruction logic.
export const KOAN_CACHE_KEY = "koan-plus-cache-v3";
export const GRADES_CACHE_KEY = "koan-plus-grades-v1";
export const CLE_CACHE_KEY = "koan-plus-cle-v2";
export const CLE_MATERIALS_CACHE_KEY = "koan-plus-cle-materials-v14";
export const ONBOARDING_KEY = "koan-plus-onboarding-v1";
export const THEME_KEY = "koan-plus-theme";

/**
 * Keys that were used by versions that predate the current cache key names.
 * Keep this list explicit: localStorage has no namespace or migration
 * facility, so changing a key otherwise leaves the old value behind forever.
 */
export const LEGACY_STORAGE_KEYS = [
  "koan-plus-cache-v2",
  "koan-plus-cle-v1",
] as const;

const KOAN_COORDINATION_KEYS = [
  "koan-plus-light-refresh-lease-v1",
  "koan-plus-light-refresh-attempt-v1",
  "koan-plus-light-refresh-failure-v1",
  "koan-plus-snapshot-lease-v1",
  "koan-plus-snapshot-attempt-v1",
  "koan-plus-snapshot-completed-v2",
  "koan-plus-snapshot-failure-v1",
  "koan-plus-notice-resolve-lease-v1",
  "koan-plus-notice-resolve-failure-v1",
  "koan-plus-notice-url-cache-v1",
  "koan-plus-grades-lease-v1",
  "koan-plus-grades-attempt-v1",
] as const;

const CLE_COORDINATION_KEYS = [
  "koan-plus-cle-refresh-lease-v1",
  "koan-plus-cle-refresh-attempt-v1",
  "koan-plus-cle-refresh-failure-v1",
  "koan-plus-cle-courses-failure-v1",
  "koan-plus-cle-tasks-failure-v1",
  "koan-plus-cle-messages-failure-v1",
] as const;

// The suffix is a notice key and therefore cannot be enumerated from a fixed
// list. It is intentionally matched by prefix during diagnostics and cleanup.
export const NOTICE_RESOLVE_ATTEMPT_PREFIX = "koan-plus-notice-resolve-attempt-v1:";
const NOTICE_RESOLVE_ATTEMPT_PREFIXES = [
  NOTICE_RESOLVE_ATTEMPT_PREFIX,
  "koan-plus-notice-resolve-attempt-",
] as const;

const CACHE_KEYS = [
  KOAN_CACHE_KEY,
  GRADES_CACHE_KEY,
  CLE_CACHE_KEY,
  CLE_MATERIALS_CACHE_KEY,
  ...LEGACY_STORAGE_KEYS,
] as const;

/** Current and legacy cache values that participate in export/cleanup. */
export const KNOWN_CACHE_KEYS = CACHE_KEYS;

const CLEARABLE_KEYS = new Set<string>([
  ...CACHE_KEYS,
  ...KOAN_COORDINATION_KEYS,
  ...CLE_COORDINATION_KEYS,
  "koan-plus-sync-state-v1",
]);

export const TERMS_VERSION = "2026-06-06";
export const PRIVACY_VERSION = "2026-09-05";

export type OnboardingRecord = {
  completed: true;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
};

export type StorageErrorKind =
  | "unavailable"
  | "read"
  | "parse"
  | "serialize"
  | "quota"
  | "write"
  | "remove"
  | "export";

export type StorageDiagnostic = {
  key: string;
  kind: StorageErrorKind;
  message: string;
  at: string;
  bytes?: number;
};

export type StorageWriteResult =
  | { ok: true; key: string; bytes: number }
  | { ok: false; key: string; error: StorageDiagnostic; bytes?: number };

export type StorageClearResult = {
  ok: boolean;
  removed: string[];
  failed: StorageDiagnostic[];
};

export type StorageUsageEntry = {
  key: string;
  characters: number;
  utf8Bytes: number;
  managed: boolean;
};

export type StorageUsage = {
  ok: boolean;
  totalCharacters: number;
  totalUtf8Bytes: number;
  entries: StorageUsageEntry[];
  error?: StorageDiagnostic;
};

export type StorageExportResult =
  | {
    ok: true;
    json: string;
    bytes: number;
    keys: string[];
    rawKeys: string[];
  }
  | { ok: false; error: StorageDiagnostic };

const diagnostics: StorageDiagnostic[] = [];
const MAX_DIAGNOSTICS = 50;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isQuotaError(error: unknown) {
  return Boolean(
    error && typeof error === "object" &&
    ((error as { name?: unknown }).name === "QuotaExceededError" ||
      (error as { code?: unknown }).code === 22),
  );
}

function recordDiagnostic(
  key: string,
  kind: StorageErrorKind,
  error: unknown,
  bytes?: number,
) {
  const diagnostic: StorageDiagnostic = {
    key,
    kind,
    message: errorMessage(error),
    at: new Date().toISOString(),
    ...(bytes === undefined ? {} : { bytes }),
  };
  diagnostics.push(diagnostic);
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();
  return diagnostic;
}

/** Return a copy so callers cannot mutate the in-memory error history. */
export function getStorageDiagnostics() {
  return diagnostics.map((diagnostic) => ({ ...diagnostic }));
}

export function getLastStorageDiagnostic() {
  const diagnostic = diagnostics[diagnostics.length - 1];
  return diagnostic ? { ...diagnostic } : null;
}

/** Allow small preference helpers to report failures without importing a raw writer. */
export function recordStorageDiagnostic(
  key: string,
  kind: StorageErrorKind,
  error: unknown,
) {
  return recordDiagnostic(key, kind, error);
}

export function clearStorageDiagnostics() {
  diagnostics.length = 0;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch (error) {
    recordDiagnostic("localStorage", "unavailable", error);
    return null;
  }
}

function utf8Bytes(value: string) {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    // TextEncoder is available in supported browsers. The fallback keeps the
    // diagnostic API usable in constrained test/runtime environments.
    return value.length * 2;
  }
}

function readRaw(key: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    recordDiagnostic(key, "read", error);
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const value = readRaw(key);
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    recordDiagnostic(key, "parse", error, utf8Bytes(value));
    return null;
  }
}

function writeJson<T>(key: string, value: T): StorageWriteResult {
  let serialized: string;
  try {
    const result = JSON.stringify(value);
    if (result === undefined) {
      throw new TypeError("JSON.stringify returned undefined");
    }
    serialized = result;
  } catch (error) {
    return {
      ok: false,
      key,
      error: recordDiagnostic(key, "serialize", error),
    };
  }

  const bytes = utf8Bytes(serialized);
  const storage = getStorage();
  if (!storage) {
    return {
      ok: false,
      key,
      bytes,
      error: recordDiagnostic(key, "unavailable", "localStorage is unavailable", bytes),
    };
  }

  // Web Storage setItem is atomic, but retaining the old raw value lets the
  // wrapper restore it in test doubles and unusual host implementations that
  // throw after mutating their backing map.
  let previous: string | null = null;
  try {
    previous = storage.getItem(key);
  } catch (error) {
    recordDiagnostic(key, "read", error);
  }
  try {
    storage.setItem(key, serialized);
    return { ok: true, key, bytes };
  } catch (error) {
    const kind: StorageErrorKind = isQuotaError(error) ? "quota" : "write";
    const diagnostic = recordDiagnostic(key, kind, error, bytes);
    try {
      if (previous === null) storage.removeItem(key);
      else storage.setItem(key, previous);
    } catch (restoreError) {
      recordDiagnostic(key, "write", restoreError, previous ? utf8Bytes(previous) : 0);
    }
    return { ok: false, key, bytes, error: diagnostic };
  }
}

function allStorageKeys() {
  const storage = getStorage();
  if (!storage) return null;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch (error) {
    recordDiagnostic("localStorage", "read", error);
    return null;
  }
}

function isNoticeAttemptKey(key: string) {
  return NOTICE_RESOLVE_ATTEMPT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isManagedKey(key: string) {
  return CLEARABLE_KEYS.has(key) || isNoticeAttemptKey(key) ||
    key === ONBOARDING_KEY || key === THEME_KEY;
}

function isClearableKey(key: string, includePreferences: boolean) {
  return CLEARABLE_KEYS.has(key) || isNoticeAttemptKey(key) ||
    (includePreferences && (key === ONBOARDING_KEY || key === THEME_KEY));
}

/** Enumerate existing managed keys, including dynamic per-notice keys. */
export function listManagedStorageKeys() {
  const keys = allStorageKeys();
  if (!keys) return [];
  return keys.filter(isManagedKey).sort();
}

/**
 * Inspect localStorage without changing it. `utf8Bytes` is a portable lower
 * bound for quota diagnostics; browser quota accounting can differ.
 */
export function getStorageUsage(): StorageUsage {
  const keys = allStorageKeys();
  if (!keys) {
    return {
      ok: false,
      totalCharacters: 0,
      totalUtf8Bytes: 0,
      entries: [],
      error: getLastStorageDiagnostic() || recordDiagnostic(
        "localStorage",
        "unavailable",
        "localStorage is unavailable",
      ),
    };
  }
  const entries: StorageUsageEntry[] = [];
  for (const key of keys) {
    const value = readRaw(key);
    if (value === null) continue;
    entries.push({
      key,
      characters: value.length,
      utf8Bytes: utf8Bytes(value),
      managed: isManagedKey(key),
    });
  }
  return {
    ok: true,
    totalCharacters: entries.reduce((sum, entry) => sum + entry.characters, 0),
    totalUtf8Bytes: entries.reduce((sum, entry) => sum + entry.utf8Bytes, 0),
    entries: entries.sort((left, right) => right.utf8Bytes - left.utf8Bytes),
  };
}

/**
 * Remove all cache, coordination, legacy and dynamic notice-attempt values.
 * Preferences/onboarding are intentionally retained unless explicitly asked
 * for, so a cache reset cannot silently reset the consent flow or theme.
 */
export function clearCacheStorage(options: { includePreferences?: boolean } = {}): StorageClearResult {
  const includePreferences = Boolean(options.includePreferences);
  const storage = getStorage();
  if (!storage) {
    const error = getLastStorageDiagnostic() || recordDiagnostic(
      "localStorage",
      "unavailable",
      "localStorage is unavailable",
    );
    return { ok: false, removed: [], failed: [error] };
  }
  const existing = allStorageKeys() || [];
  const keys = [...new Set([
    ...existing.filter((key) => isClearableKey(key, includePreferences)),
    ...[...CLEARABLE_KEYS].filter((key) => isClearableKey(key, includePreferences)),
  ])].sort();
  const removed: string[] = [];
  const failed: StorageDiagnostic[] = [];
  for (const key of keys) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch (error) {
      failed.push(recordDiagnostic(key, "remove", error));
    }
  }
  return { ok: failed.length === 0, removed, failed };
}

export function clearAllStoredData() {
  return clearCacheStorage({ includePreferences: true });
}

/**
 * Export only JSON cache values, never credentials or browser session data.
 * Malformed values are retained as raw strings so a user can still hand the
 * backup to a recovery tool instead of losing the evidence.
 */
export function exportCacheJson(): StorageExportResult {
  const entries: Record<string, unknown> = {};
  const rawEntries: Record<string, string> = {};
  const keys: string[] = [];
  const rawKeys: string[] = [];
  for (const key of CACHE_KEYS) {
    const raw = readRaw(key);
    if (raw === null) continue;
    try {
      entries[key] = JSON.parse(raw) as unknown;
      keys.push(key);
    } catch (error) {
      rawEntries[key] = raw;
      rawKeys.push(key);
      recordDiagnostic(key, "parse", error, utf8Bytes(raw));
    }
  }
  const payload = {
    format: "koan-plus-cache-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    rawEntries,
  };
  try {
    const json = JSON.stringify(payload, null, 2);
    if (json === undefined) throw new TypeError("JSON.stringify returned undefined");
    return { ok: true, json, bytes: utf8Bytes(json), keys, rawKeys };
  } catch (error) {
    return {
      ok: false,
      error: recordDiagnostic("cache-export", "export", error),
    };
  }
}

export function loadOnboardingRecord(): OnboardingRecord | null {
  const record = readJson<Partial<OnboardingRecord>>(ONBOARDING_KEY);
  if (
    record?.completed !== true ||
    record.termsVersion !== TERMS_VERSION ||
    record.privacyVersion !== PRIVACY_VERSION ||
    typeof record.acceptedAt !== "string"
  ) {
    return null;
  }
  return record as OnboardingRecord;
}

function createOnboardingRecord(): OnboardingRecord {
  return {
    completed: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: new Date().toISOString(),
  };
}

export function saveOnboardingRecordResult(): StorageWriteResult {
  return writeJson(ONBOARDING_KEY, createOnboardingRecord());
}

export function saveOnboardingRecord(): OnboardingRecord | null {
  const record = createOnboardingRecord();
  // Keep the record-shaped return for existing callers while making failure
  // explicit. New UI code should prefer saveOnboardingRecordResult() when it
  // needs the diagnostic kind and message.
  return writeJson(ONBOARDING_KEY, record).ok ? record : null;
}

export function loadCache<T>(): T | null {
  return readJson<T>(KOAN_CACHE_KEY);
}

export function saveCache<T>(cache: T): StorageWriteResult {
  return writeJson(KOAN_CACHE_KEY, cache);
}

export function loadGradesCache<T>(): T | null {
  return readJson<T>(GRADES_CACHE_KEY);
}

export function saveGradesCache<T>(cache: T): StorageWriteResult {
  return writeJson(GRADES_CACHE_KEY, cache);
}

export function loadCleCache<T>(): T | null {
  return readJson<T>(CLE_CACHE_KEY);
}

export function saveCleCache<T>(cache: T): StorageWriteResult {
  return writeJson(CLE_CACHE_KEY, cache);
}

export function loadCleMaterialsCache<T>(): T | null {
  return readJson<T>(CLE_MATERIALS_CACHE_KEY);
}

export function saveCleMaterialsCache<T>(cache: T): StorageWriteResult {
  return writeJson(CLE_MATERIALS_CACHE_KEY, cache);
}

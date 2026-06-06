const CACHE_KEY = "koan-plus-cache-v2";
const GRADES_CACHE_KEY = "koan-plus-grades-v1";
const CLE_CACHE_KEY = "koan-plus-cle-v1";
const ONBOARDING_KEY = "koan-plus-onboarding-v1";

export const TERMS_VERSION = "2026-06-06";
export const PRIVACY_VERSION = "2026-06-06";

export type OnboardingRecord = {
  completed: true;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
};

export function loadOnboardingRecord(): OnboardingRecord | null {
  try {
    const value = localStorage.getItem(ONBOARDING_KEY);
    if (!value) return null;
    const record = JSON.parse(value) as Partial<OnboardingRecord>;
    if (
      record.completed !== true ||
      record.termsVersion !== TERMS_VERSION ||
      record.privacyVersion !== PRIVACY_VERSION ||
      typeof record.acceptedAt !== "string"
    ) {
      return null;
    }
    return record as OnboardingRecord;
  } catch {
    return null;
  }
}

export function saveOnboardingRecord(): OnboardingRecord {
  const record: OnboardingRecord = {
    completed: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: new Date().toISOString(),
  };
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(record));
  return record;
}

export function loadCache<T>(): T | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveCache<T>(cache: T) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function loadGradesCache<T>(): T | null {
  try {
    const value = localStorage.getItem(GRADES_CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveGradesCache<T>(cache: T) {
  localStorage.setItem(GRADES_CACHE_KEY, JSON.stringify(cache));
}

export function loadCleCache<T>(): T | null {
  try {
    const value = localStorage.getItem(CLE_CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveCleCache<T>(cache: T) {
  localStorage.setItem(CLE_CACHE_KEY, JSON.stringify(cache));
}

const CACHE_KEY = "koan-plus-cache-v2";
const GRADES_CACHE_KEY = "koan-plus-grades-v1";

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

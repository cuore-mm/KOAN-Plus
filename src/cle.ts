import { MANUAL_REFRESH_TTL_MS } from "./sync";
import {
  CLE_MATERIALS_CACHE_KEY,
  loadCleMaterialsCache,
  saveCleMaterialsCache,
  type StorageWriteResult,
} from "./storage";

const CLE_ORIGIN = "https://www.cle.osaka-u.ac.jp";
const API_ORIGIN = `${CLE_ORIGIN}/learn/api`;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const CLE_REFRESH_DEADLINE_MS = 120 * 1000;
const REQUEST_RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 10 * 1000;
const MAX_RESPONSE_TEXT_LENGTH = 10 * 1024 * 1024;
const MAX_MESSAGE_PAGES = 8;
const MESSAGE_PAGE_SIZE = 100;
const MESSAGE_SUMMARY_PATH = "/learn/api/v1/messages/summary";
const TASK_STATUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TASK_STATUS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const NORMAL_STATUS_TASK_LIMIT = 6;
const FORCED_STATUS_TASK_LIMIT = 12;
const GRADED_STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ANNOUNCEMENT_COURSES_PER_REFRESH = 4;
// Material lists are intentionally kept usable for longer than the dashboard
// summary. Opening a course should be cache-first; an explicit "再取得" is
// available when the user needs to verify the latest list immediately.
const MATERIALS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const MATERIALS_CACHE_MAX_COURSES = 50;
export const MATERIALS_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MATERIALS_CACHE_RETRY_MAX_COURSES = 25;
const MATERIALS_PAGE_SIZE = 100;
const MAX_MATERIAL_FOLDER_DEPTH = 8;
const MAX_API_PAGES = 100;
const MATERIAL_FETCH_CONCURRENCY = 3;
const SYNC_CONCURRENCY = 3;
const CLE_LEASE_KEY = "koan-plus-cle-refresh-lease-v1";
const CLE_ATTEMPT_KEY = "koan-plus-cle-refresh-attempt-v1";
const CLE_FAILURE_KEY = "koan-plus-cle-refresh-failure-v1";
const CLE_COURSES_FAILURE_KEY = "koan-plus-cle-courses-failure-v1";
const CLE_TASKS_FAILURE_KEY = "koan-plus-cle-tasks-failure-v1";
const CLE_MESSAGES_FAILURE_KEY = "koan-plus-cle-messages-failure-v1";
const CLE_TASK_SCOPE_VERSION = 3;
export const CLE_TASKS_TTL_MS = 10 * 60 * 1000;
export const CLE_MESSAGES_TTL_MS = 15 * 60 * 1000;
export const CLE_MESSAGES_FOCUSED_TTL_MS = 5 * 60 * 1000;
export const CLE_COURSES_TTL_MS = 24 * 60 * 60 * 1000;
export const CLE_TASK_STATUSES_TTL_MS = 30 * 60 * 1000;
export const CLE_ANNOUNCEMENTS_TTL_MS = 2 * 60 * 60 * 1000;

export const CLE_MESSAGES_URL = `${CLE_ORIGIN}/ultra/messages`;
export const CLE_CALENDAR_URL = `${CLE_ORIGIN}/ultra/calendar`;

export type CleTaskStatus =
  | "未着手"
  | "一時保存"
  | "提出済み"
  | "採点済み"
  | "期限切れ"
  | "状態不明";

export type CleTask = {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  dueAt: string | null;
  status: CleTaskStatus;
  score?: number;
  possibleScore?: number;
  statusUpdatedAt?: string | null;
};

export type CleMessageCourse = {
  courseId: string;
  courseName: string;
  unreadCount: number;
};

export type CleCourse = {
  courseId: string;
  displayId: string;
  timetableCode: string;
  name: string;
  available?: boolean;
};

export type CleAnnouncement = {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  body: string;
  created: string;
};

export type CleAnnouncementCourseCache = {
  announcements: CleAnnouncement[];
  updatedAt: string | null;
  failureCount?: number;
  nextRetryAt?: number;
};

export type CleMaterial = {
  id: string;
  contentId: string;
  attachmentId: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  addedAt: string;
  folderPath: string[];
  downloadUrl: string;
};

export type CleMaterialList = {
  courseId: string;
  materials: CleMaterial[];
  updatedAt: string;
  complete?: boolean;
  warnings?: string[];
};

export type CleData = {
  courses: CleCourse[];
  tasks: CleTask[];
  messages: CleMessageCourse[];
  unreadMessages: number;
  announcements?: CleAnnouncement[];
  updatedAt: string | null;
  tasksUpdatedAt: string | null;
  messagesUpdatedAt: string | null;
  messagesNextPage?: string | null;
  messagesComplete?: boolean;
  messagesPendingCount?: number;
  coursesUpdatedAt: string | null;
  taskStatusesUpdatedAt: string | null;
  taskScopeVersion?: number;
  taskStatusCursor?: number;
  announcementsUpdatedAt?: string | null;
  announcementCourses?: Record<string, CleAnnouncementCourseCache>;
  announcementsPendingCount?: number;
  taskStatusPendingCount?: number;
  warnings?: string[];
};

export const EMPTY_CLE_DATA: CleData = {
  courses: [],
  tasks: [],
  messages: [],
  unreadMessages: 0,
  announcements: [],
  updatedAt: null,
  tasksUpdatedAt: null,
  messagesUpdatedAt: null,
  messagesNextPage: null,
  messagesComplete: true,
  messagesPendingCount: 0,
  coursesUpdatedAt: null,
  taskStatusesUpdatedAt: null,
  taskScopeVersion: CLE_TASK_SCOPE_VERSION,
  taskStatusCursor: 0,
  announcementsUpdatedAt: null,
  announcementCourses: {},
  announcementsPendingCount: 0,
  taskStatusPendingCount: 0,
  warnings: [],
};

type CleTabResponse = {
  ok: boolean;
  status: number;
  text?: string;
  url?: string;
  retryAfterMs?: number | string;
  retryAfter?: string;
  contentDisposition?: string;
  contentType?: string;
};

type CleTabMessage = {
  ok: boolean;
  response?: CleTabResponse;
  error?: string;
  downloadId?: number;
  files?: Array<{ url: string; fileName: string; contentId?: string }>;
  heads?: Array<{ url: string; ok: boolean; contentDisposition: string; contentType: string }>;
};

type JsonRecord = Record<string, unknown>;
export type CleActiveCourse = {
  code: string;
  title: string;
  year: string;
};
type CleRefreshOptions = {
  activeCourses?: CleActiveCourse[];
  priorityCourseCode?: string;
  messagesFocused?: boolean;
  refreshRecent?: boolean;
  bypassBackoff?: boolean;
};

const jsonRequests = new Map<string, Promise<unknown>>();
const materialRequests = new Map<string, Promise<CleMaterialList>>();
const downloadRequests = new Map<string, Promise<number>>();

type CleRefreshContext = {
  deadlineAt: number;
};

class CleRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      retryAfterMs?: number;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "CleRequestError";
    this.status = options.status || 0;
    this.retryAfterMs = Math.max(0, options.retryAfterMs || 0);
    this.retryable = options.retryable ?? isRetryableStatus(this.status);
  }
}

class CleDeadlineError extends Error {
  constructor() {
    super("CLE更新の全体期限に達したため、取得できたデータだけを保持しました。");
    this.name = "CleDeadlineError";
  }
}

class ClePartialResultsError extends Error {
  readonly results: JsonRecord[];

  constructor(message: string, results: JsonRecord[]) {
    super(message);
    this.name = "ClePartialResultsError";
    this.results = results;
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfter(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value !== "string") return 0;
  const normalized = value.trim();
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function refreshRemaining(context?: CleRefreshContext) {
  return context ? Math.max(0, context.deadlineAt - Date.now()) : Number.POSITIVE_INFINITY;
}

function ensureRefreshTime(context?: CleRefreshContext) {
  if (context && refreshRemaining(context) <= 0) throw new CleDeadlineError();
}

function refreshTimeout(context?: CleRefreshContext) {
  const remaining = refreshRemaining(context);
  return Math.min(REQUEST_TIMEOUT_MS, remaining);
}

function retryDelay(error: CleRequestError, attempt: number) {
  if (error.retryAfterMs > 0) return error.retryAfterMs;
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * (2 ** attempt),
  );
  // A small jitter prevents several tabs/courses from retrying in lockstep.
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 2)));
  return Math.min(
    RETRY_MAX_DELAY_MS,
    exponential + jitter,
  );
}

async function waitForRetry(milliseconds: number, context?: CleRefreshContext) {
  ensureRefreshTime(context);
  const delay = Math.min(milliseconds, refreshRemaining(context));
  if (delay <= 0) throw new CleDeadlineError();
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delay);
  });
  ensureRefreshTime(context);
}

function readCoordinationValue(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) || null;
  } catch {
    // Coordination state is advisory. A blocked or unavailable Web Storage
    // must not turn an otherwise usable CLE response into a sync failure.
    return null;
  }
}

function writeCoordinationValue(key: string, value: string) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeCoordinationValue(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Best effort: stale coordination state is preferable to failing data
    // acquisition when storage is unavailable or quota-restricted.
  }
}

function readTimestamp(key: string) {
  const value = Number.parseInt(readCoordinationValue(key) || "", 10);
  return Number.isFinite(value) ? value : 0;
}

function timestampValue(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFresh(value: string | null | undefined, ttl: number) {
  return isFreshAt(value, ttl, Date.now());
}

function isFreshAt(
  value: string | null | undefined,
  ttl: number,
  now: number,
) {
  const timestamp = timestampValue(value);
  const age = now - timestamp;
  return timestamp > 0 && age >= 0 && age < ttl;
}

function clePartUpdatedAt(previous: CleData | null | undefined, key: keyof Pick<
  CleData,
  "coursesUpdatedAt" | "tasksUpdatedAt" | "messagesUpdatedAt" | "taskStatusesUpdatedAt" | "announcementsUpdatedAt"
>) {
  if (previous && key in previous) {
    return (previous[key] as string | null) || null;
  }
  return previous?.updatedAt || null;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const latest = Math.max(0, ...values.map(timestampValue));
  return latest ? new Date(latest).toISOString() : null;
}

export function isCleCacheFresh(data: CleData, refreshRecent = false) {
  if (data.taskScopeVersion !== CLE_TASK_SCOPE_VERSION) return false;
  if (data.courses?.length && !data.courses.some((c) => "available" in c)) {
    return false;
  }
  const hasAnnouncementScope = Boolean(
    data.announcementsUpdatedAt ||
    (data.announcements?.length || 0) > 0 ||
    Object.keys(data.announcementCourses || {}).length > 0,
  );
  return (
    isFresh(clePartUpdatedAt(data, "coursesUpdatedAt"), CLE_COURSES_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "tasksUpdatedAt"), refreshRecent ? MANUAL_REFRESH_TTL_MS : CLE_TASKS_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "messagesUpdatedAt"), refreshRecent ? MANUAL_REFRESH_TTL_MS : CLE_MESSAGES_TTL_MS) &&
    data.messagesComplete !== false &&
    (data.messagesPendingCount || 0) === 0 &&
    isFresh(clePartUpdatedAt(data, "taskStatusesUpdatedAt"), refreshRecent ? MANUAL_REFRESH_TTL_MS : CLE_TASK_STATUSES_TTL_MS) &&
    (data.taskStatusPendingCount || 0) === 0 &&
    (data.announcementsPendingCount || 0) === 0 &&
    (!hasAnnouncementScope || isFresh(
      clePartUpdatedAt(data, "announcementsUpdatedAt"),
      CLE_ANNOUNCEMENTS_TTL_MS,
    ))
  );
}

type FailureState = {
  count: number;
  nextRetryAt: number;
};

function readFailureState(key: string): FailureState {
  try {
    const state = JSON.parse(readCoordinationValue(key) || "{}") as Partial<FailureState>;
    return {
      count: Number.isFinite(state.count) ? Number(state.count) : 0,
      nextRetryAt: Number.isFinite(state.nextRetryAt) ? Number(state.nextRetryAt) : 0,
    };
  } catch {
    return { count: 0, nextRetryAt: 0 };
  }
}

function requireRetryAvailable(key: string, label: string) {
  const retryAt = readFailureState(key).nextRetryAt;
  if (retryAt <= Date.now()) return;
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  throw new Error(`${label}は失敗後の待機中です。${seconds}秒後に再試行できます。`);
}

function retryAvailable(key: string) {
  return readFailureState(key).nextRetryAt <= Date.now();
}

function recordFailure(key: string, retryAfterMs = 0) {
  const previous = readFailureState(key);
  const count = previous.count + 1;
  const base = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(count - 1, 6)));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base / 4)));
  const delay = Math.min(60 * 60 * 1000, Math.max(base + jitter, retryAfterMs));
  writeCoordinationValue(key, JSON.stringify({
    count,
    nextRetryAt: Date.now() + delay,
  }));
}

function retryAfterFromError(error: unknown) {
  return error instanceof CleRequestError ? error.retryAfterMs : 0;
}

function acquireLease() {
  const now = Date.now();
  if (readTimestamp(CLE_LEASE_KEY) > now) {
    throw new Error("別の画面でCLEを更新中です。");
  }
  const leaseValue = `${now + CLE_REFRESH_DEADLINE_MS + REQUEST_TIMEOUT_MS}:${Math.random().toString(36).slice(2)}`;
  const release = () => {
    if (readCoordinationValue(CLE_LEASE_KEY) === leaseValue) {
      removeCoordinationValue(CLE_LEASE_KEY);
    }
  };
  // A failed write disables the cross-tab lease. Still return a guarded
  // release function in case a host implementation threw after mutating its
  // backing store.
  writeCoordinationValue(CLE_LEASE_KEY, leaseValue);
  return release;
}

function requireCooldown(key: string, milliseconds: number, message: string) {
  if (Date.now() - readTimestamp(key) < milliseconds) throw new Error(message);
}

function requireCleApiUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== CLE_ORIGIN || !parsed.pathname.startsWith("/learn/api/")) {
    throw new Error("CLE API以外への通信は許可されていません。");
  }
}

function isCleAuthenticationError(error: unknown) {
  if (error instanceof CleRequestError && [401, 403].includes(error.status)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\((?:401|403)\)|ログイン|認証|セッション/i.test(message);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function results(value: unknown) {
  const items = asRecord(value).results;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function requiredResults(value: unknown, label: string) {
  const items = asRecord(value).results;
  if (!Array.isArray(items)) {
    throw new Error(`${label}の応答形式を確認できませんでした。以前のデータを保持します。`);
  }
  return items.map(asRecord);
}

function pagingNextUrl(value: unknown) {
  const paging = asRecord(asRecord(value).paging);
  return asString(paging.nextPage);
}

function courseCodeFromDisplayId(value: string) {
  return value.match(/^\d{4}-\d{2}-(\d{6})-/)?.[1] || "";
}

function courseYearFromDisplayId(value: string) {
  return value.match(/^(\d{4})-/)?.[1] || "";
}

function cleanCourseName(value: string) {
  const withoutCode = value.replace(/^[^:]+:\s*\d+\s*/, "");
  const japanese = withoutCode.split(/\s*\/\s*/)[0];
  return japanese
    .replace(/^【取消】/, "")
    .replace(/\s*【[^】]*】/g, "")
    .replace(/[ 　]+/g, "")
    .toLowerCase();
}

function courseNamesMatch(left: string, right: string) {
  const l = cleanCourseName(left);
  const r = cleanCourseName(right);
  return Boolean(l && r && (l.includes(r) || r.includes(l)));
}

export function resolveActiveCleCourses(
  courses: CleCourse[],
  activeCourses: CleActiveCourse[],
) {
  const resolved = new Map<string, CleCourse>();
  for (const active of activeCourses) {
    const sameYear = courses.filter(
      (course) => courseYearFromDisplayId(course.displayId) === active.year,
    );
    const directWithMatchingName = sameYear.find(
      (course) =>
        course.available !== false &&
        course.timetableCode === active.code &&
        courseNamesMatch(active.title, course.name),
    );
    const direct = sameYear.find(
      (course) =>
        course.available !== false &&
        course.timetableCode === active.code,
    );
    const byName = sameYear.find(
      (course) =>
        course.available !== false &&
        courseNamesMatch(active.title, course.name),
    );
    const match = directWithMatchingName || direct || byName;
    if (match) resolved.set(match.courseId, match);
  }
  return [...resolved.values()];
}

function isYes(value: unknown) {
  return value === true || String(value).toLowerCase() === "yes" || String(value) === "1";
}

async function withTimeout<T>(
  task: Promise<T>,
  milliseconds: number,
  context?: CleRefreshContext,
) {
  ensureRefreshTime(context);
  const timeoutMs = Math.min(milliseconds, refreshTimeout(context));
  if (timeoutMs <= 0) throw new CleDeadlineError();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(
          () => reject(new Error("CLE APIの応答が30秒以内に返りませんでした。CLEタブを再読み込みして再試行してください。")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

async function fetchJsonOnce(url: string, tabId?: number, context?: CleRefreshContext) {
  ensureRefreshTime(context);
  requireCleApiUrl(url);
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("CLE取得はChrome拡張機能から実行してください。");
  }
  let result: CleTabMessage;
  try {
    result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-fetch",
        request: { url, options: { method: "GET" } },
        tabId,
      }) as Promise<CleTabMessage>,
      REQUEST_TIMEOUT_MS,
      context,
    );
  } catch (error) {
    if (error instanceof CleDeadlineError) throw error;
    throw new CleRequestError(
      error instanceof Error ? error.message : String(error),
      { retryable: !isCleAuthenticationError(error), cause: error },
    );
  }
  if (!result.ok || !result.response) {
    throw new CleRequestError(
      result.error || "CLEタブから応答を取得できませんでした。",
      { retryable: !isCleAuthenticationError(result.error) },
    );
  }
  const response = result.response;
  const parsedStatus = Number(response.status);
  const status = Number.isFinite(parsedStatus) ? parsedStatus : 0;
  const retryAfterMs = parseRetryAfter(response.retryAfterMs ?? response.retryAfter);
  if (!response.ok) {
    throw new CleRequestError(
      `CLEの取得に失敗しました (${response.status})。`,
      {
        status,
        retryAfterMs,
        retryable: isRetryableStatus(status),
      },
    );
  }
  if (response.url) {
    const responseUrl = new URL(response.url);
    if (responseUrl.protocol !== "https:" || responseUrl.origin !== CLE_ORIGIN) {
      throw new CleRequestError("CLE以外へリダイレクトされたため、取得を中止しました。", {
        retryable: false,
      });
    }
  }
  const text = response.text || "";
  if (text.length > MAX_RESPONSE_TEXT_LENGTH) {
    throw new CleRequestError("CLEの応答が大きすぎるため、取得を中止しました。", {
      retryable: false,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CleRequestError(
      "CLEからJSON以外の応答が返りました。ログイン状態を確認してください。",
      { retryable: false },
    );
  }
}

async function fetchJson(url: string, tabId?: number, context?: CleRefreshContext) {
  requireCleApiUrl(url);
  const key = `${tabId || "auto"}:${url}`;
  const existing = jsonRequests.get(key);
  if (existing) return existing;
  const request = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      ensureRefreshTime(context);
      try {
        return await fetchJsonOnce(url, tabId, context);
      } catch (error) {
        if (error instanceof CleDeadlineError) throw error;
        const requestError = error instanceof CleRequestError
          ? error
          : new CleRequestError(
            error instanceof Error ? error.message : String(error),
            { retryable: !isCleAuthenticationError(error), cause: error },
          );
        if (
          !requestError.retryable ||
          isCleAuthenticationError(requestError) ||
          attempt >= REQUEST_RETRY_LIMIT
        ) {
          throw requestError;
        }
        await waitForRetry(retryDelay(requestError, attempt), context);
      }
    }
  })();
  jsonRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (jsonRequests.get(key) === request) jsonRequests.delete(key);
  }
}

type MaterialCache = Record<string, CleMaterialList>;

function isValidMaterial(value: unknown): value is CleMaterial {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    typeof record.contentId === "string" &&
    typeof record.attachmentId === "string" &&
    typeof record.title === "string" &&
    typeof record.fileName === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number" &&
    Number.isFinite(record.size) &&
    typeof record.addedAt === "string" &&
    Array.isArray(record.folderPath) &&
    record.folderPath.every((part) => typeof part === "string") &&
    typeof record.downloadUrl === "string"
  );
}

function normalizeMaterialList(courseId: string, value: unknown): CleMaterialList | null {
  const record = asRecord(value);
  if (record.courseId !== courseId || typeof record.updatedAt !== "string") return null;
  if (!timestampValue(record.updatedAt)) return null;
  if (!Array.isArray(record.materials)) return null;
  const materials = record.materials.filter(isValidMaterial);
  // A list containing only malformed material rows is not a usable stale
  // fallback. Mixed lists retain the valid rows instead of losing the whole
  // course because one API item was corrupted.
  if (record.materials.length > 0 && materials.length === 0) return null;
  const complete = typeof record.complete === "boolean" ? record.complete : undefined;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  return {
    courseId,
    materials,
    updatedAt: record.updatedAt,
    ...(complete === undefined ? {} : { complete }),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** @internal Exposed for cache-retention tests and diagnostics. */
export function retainMaterialCache(cache: unknown, preserveCourseId?: string): MaterialCache {
  const cutoff = Date.now() - MATERIALS_CACHE_MAX_AGE_MS;
  const entries = Object.entries(asRecord(cache))
    .map(([courseId, value]) => [courseId, normalizeMaterialList(courseId, value)] as const)
    .filter((entry): entry is readonly [string, CleMaterialList] => {
      const [courseId, value] = entry;
      return Boolean(
        value &&
        (courseId === preserveCourseId || timestampValue(value.updatedAt) >= cutoff),
      );
    })
    .sort((left, right) =>
      timestampValue(right[1].updatedAt) - timestampValue(left[1].updatedAt),
    );

  if (preserveCourseId) {
    const preservedIndex = entries.findIndex(([courseId]) => courseId === preserveCourseId);
    if (preservedIndex > 0) {
      const [preserved] = entries.splice(preservedIndex, 1);
      entries.unshift(preserved);
    }
  }
  return Object.fromEntries(entries.slice(0, MATERIALS_CACHE_MAX_COURSES));
}

function loadMaterialCache(preserveCourseId?: string): MaterialCache {
  return retainMaterialCache(loadCleMaterialsCache<unknown>(), preserveCourseId);
}

function saveMaterialCache(cache: MaterialCache, preserveCourseId?: string): StorageWriteResult {
  return saveCleMaterialsCache(retainMaterialCache(cache, preserveCourseId));
}

function shrinkMaterialCache(cache: MaterialCache, preserveCourseId: string): MaterialCache {
  const retained = retainMaterialCache(cache, preserveCourseId);
  const entries = Object.entries(retained).sort((left, right) =>
    timestampValue(right[1].updatedAt) - timestampValue(left[1].updatedAt),
  );
  const preserved = entries.find(([courseId]) => courseId === preserveCourseId);
  const others = entries.filter(([courseId]) => courseId !== preserveCourseId);
  const maxOthers = Math.max(
    0,
    MATERIALS_CACHE_RETRY_MAX_COURSES - (preserved ? 1 : 0),
  );
  return Object.fromEntries([
    ...(preserved ? [preserved] : []),
    ...others.slice(0, maxOthers),
  ]);
}

/** @internal Exposed for quota-retry tests; UI callers use fetchCourseMaterials. */
export function persistMaterialCache(
  cache: MaterialCache,
  preserveCourseId: string,
  warnings: string[],
) {
  const result = saveMaterialCache(cache, preserveCourseId);
  if (result.ok) return;

  const prefix = `${CLE_MATERIALS_CACHE_KEY}の保存に失敗しました`;
  if (result.error.kind !== "quota") {
    warnings.push(`${prefix}: ${result.error.message}`);
    return;
  }

  warnings.push(`${prefix}（容量上限）。古い科目を減らして再試行します。`);
  const retry = saveMaterialCache(shrinkMaterialCache(cache, preserveCourseId), preserveCourseId);
  if (!retry.ok) {
    warnings.push(`${CLE_MATERIALS_CACHE_KEY}の縮小後保存にも失敗しました: ${retry.error.message}`);
  }
}

/** @internal Keeps persistence failures visible to the materials UI. */
export function withMaterialCacheWarnings(
  result: CleMaterialList,
  warnings: string[],
): CleMaterialList {
  const combinedWarnings = [...new Set([...(result.warnings || []), ...warnings])];
  return {
    ...result,
    complete: result.complete !== false && combinedWarnings.length === 0,
    warnings: combinedWarnings,
  };
}

export function getCachedCourseMaterials(courseId: string) {
  return loadMaterialCache(courseId)[courseId] || null;
}

export function isMaterialCacheFresh(value: CleMaterialList | null | undefined) {
  return Boolean(
    value?.updatedAt &&
    isFresh(value.updatedAt, MATERIALS_CACHE_TTL_MS),
  );
}

function contentHandlerId(item: JsonRecord) {
  return asString(asRecord(item.contentHandler).id);
}

function contentHasChildren(item: JsonRecord) {
  const handler = contentHandlerId(item);
  return asBoolean(item.hasChildren) || /folder|lesson/i.test(handler) || (/document/i.test(handler) && !/block/i.test(handler));
}

function contentMayHaveFiles(item: JsonRecord) {
  return /file|document/i.test(contentHandlerId(item));
}

function isDocumentContent(item: JsonRecord) {
  const handler = contentHandlerId(item);
  return /document/i.test(handler) && !/block/i.test(handler);
}

function cleFileUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value, CLE_ORIGIN);
    return url.origin === CLE_ORIGIN ? url.toString() : "";
  } catch {
    return "";
  }
}

function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of ["filename", "fileName", "name", "downloadName"]) {
      const candidate = url.searchParams.get(key);
      if (candidate) return decodeURIComponent(candidate);
    }
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function isInternalMaterialName(value: string) {
  const normalized = value.trim();
  return !normalized ||
    /^ultraDocumentBody$/i.test(normalized) ||
    /^xid-\d+_\d+$/i.test(normalized) ||
    /^_[0-9]+_[0-9]+$/i.test(normalized);
}

function fileNameScore(value: string, key: string) {
  if (isInternalMaterialName(value)) return -1;
  let score = 0;
  if (/\.[a-z0-9]{1,8}$/i.test(value)) score += 100;
  if (/^(originalFileName|fileName|filename|downloadName)$/i.test(key)) score += 50;
  if (/^(displayName|title|name)$/i.test(key)) score += 20;
  return score;
}

function bestFileName(value: unknown) {
  const candidates: Array<{ value: string; score: number }> = [];
  const visit = (current: unknown, key = "") => {
    if (typeof current === "string") {
      const score = fileNameScore(current, key);
      if (score >= 0) candidates.push({ value: current.trim(), score });
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key));
      return;
    }
    if (!current || typeof current !== "object") return;
    Object.entries(current as JsonRecord).forEach(([childKey, child]) => {
      if (!/url|href|body|description/i.test(childKey)) visit(child, childKey);
    });
  };
  visit(value);
  return candidates
    .sort((left, right) => right.score - left.score || left.value.length - right.value.length)[0]
    ?.value || "";
}

function materialFolderName(content: JsonRecord) {
  const title = asString(content.title);
  return isInternalMaterialName(title) ? "" : title;
}

function looksLikeFileUrl(value: string) {
  try {
    const url = new URL(value);
    return /\/download(?:\/|$|\?)/i.test(url.pathname) ||
      /\/bbcswebdav\//i.test(url.pathname) ||
      /\.[a-z0-9]{1,8}$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function embeddedMaterial(
  courseId: string,
  content: JsonRecord,
  folderPath: string[],
  fileName: string,
  downloadUrl: string,
  metadata: JsonRecord = {},
): CleMaterial | null {
  const safeUrl = cleFileUrl(downloadUrl);
  const urlName = fileNameFromUrl(safeUrl);
  const resolvedName = !isInternalMaterialName(fileName)
    ? fileName.trim()
    : !isInternalMaterialName(urlName) ? urlName : fileName.trim() || urlName;
  if (!safeUrl || !looksLikeFileUrl(safeUrl)) return null;
  const contentId = asString(content.id);
  return {
    id: `${contentId}:embedded:${safeUrl}`,
    contentId,
    attachmentId: asString(metadata.id),
    title: materialFolderName(content) || resolvedName || "配布資料",
    fileName: resolvedName || "配布資料",
    mimeType: asString(metadata.mimeType) || "application/octet-stream",
    size: asNumber(metadata.size),
    // Ultra bulk course copies stamp every item with the same created date;
    // modified tracks when the item was actually published or updated.
    addedAt:
      asString(content.modified) ||
      asString(content.created),
    folderPath,
    downloadUrl: safeUrl,
  };
}

function contentDispositionFileName(value: string) {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

function extractFileIdentifier(value: string) {
  if (!value) return "";
  const xidMatch = value.match(/(?:rid|xid)-(\d+)(?:_\d+)?/i);
  if (xidMatch) return `xid:${xidMatch[1]}`;
  const attachMatch = value.match(/\/attachments\/_?(\d+)(?:_\d+)?\/(?:download|preview)/i);
  if (attachMatch) return `attach:${attachMatch[1]}`;
  try {
    const url = new URL(value, CLE_ORIGIN);
    return url.pathname.replace(/\/+$/, "");
  } catch {
    return value;
  }
}

async function fetchFileMetadataBatch(urls: string[], tabId?: number) {
  const metadataByUrl = new Map<string, { fileName: string; mimeType: string }>();
  if (!urls.length) return metadataByUrl;
  for (let start = 0; start < urls.length; start += 100) {
    const batch = urls.slice(start, start + 100);
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({
          type: "cle-head-batch",
          urls: batch,
          tabId,
        }) as Promise<CleTabMessage>,
        Math.max(REQUEST_TIMEOUT_MS, batch.length * 4000),
      );
      if (!result?.ok && isCleAuthenticationError(result?.error)) {
        throw new Error(result?.error || "CLEの認証が切れました。");
      }
      const heads = result?.ok && Array.isArray(result.heads) ? result.heads : [];
      for (const head of heads) {
        if (!head.ok) continue;
        const id = extractFileIdentifier(head.url);
        if (id) {
          metadataByUrl.set(id, {
            fileName: contentDispositionFileName(head.contentDisposition || ""),
            mimeType: head.contentType || "",
          });
        }
      }
    } catch (error) {
      if (isCleAuthenticationError(error)) throw error;
      // Continue with the other batches and slower name resolution paths.
    }
  }
  return metadataByUrl;
}

async function fetchVisibleFileNames(tabId?: number) {
  try {
    const result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-visible-files",
        tabId,
      }) as Promise<CleTabMessage>,
      REQUEST_TIMEOUT_MS,
    );
    if (!result?.ok && isCleAuthenticationError(result?.error)) {
      throw new Error(result?.error || "CLEの認証が切れました。");
    }
    return result?.ok && Array.isArray(result.files) ? result.files : [];
  } catch (error) {
    if (isCleAuthenticationError(error)) throw error;
    return [];
  }
}

async function fetchDocumentFileNames(
  courseId: string,
  contentIds: string[],
  tabId?: number,
) {
  if (!contentIds.length) return [];
  const files: Array<{ url: string; fileName: string; contentId?: string }> = [];
  for (let start = 0; start < contentIds.length; start += 30) {
    const batch = contentIds.slice(start, start + 30);
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({
          type: "cle-document-files",
          courseId,
          contentIds: batch,
          tabId,
        }) as Promise<CleTabMessage>,
        Math.max(REQUEST_TIMEOUT_MS, batch.length * 30 * 1000),
      );
      if (!result?.ok && isCleAuthenticationError(result?.error)) {
        throw new Error(result?.error || "CLEの認証が切れました。");
      }
      if (result?.ok && Array.isArray(result.files)) files.push(...result.files);
    } catch (error) {
      if (isCleAuthenticationError(error)) throw error;
      // Keep names from successful batches; unresolved files receive fallback names.
    }
  }
  return files;
}

function normalizedFileUrl(value: string) {
  try {
    const url = new URL(value, CLE_ORIGIN);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

type CleDocumentStub = {
  contentId: string;
  // Ultra page documents render at their parent folder's URL, not their own.
  parentId: string;
};

async function resolveMaterialNames(
  courseId: string,
  materials: CleMaterial[],
  tabId?: number,
  documents: Map<string, CleDocumentStub> = new Map(),
) {
  const resolved = [...materials];
  const unresolvedIndexes = () =>
    resolved.flatMap((material, index) => isInternalMaterialName(material.fileName) ? [index] : []);
  const applyName = (index: number, fileName: string, mimeType = "") => {
    const material = resolved[index];
    resolved[index] = {
      ...material,
      title: isInternalMaterialName(material.title) ? fileName : material.title,
      fileName,
      mimeType: mimeType || material.mimeType,
    };
  };
  const applyNamesByUrl = (files: Array<{ url: string; fileName: string }>) => {
    const nameByIdentifier = new Map<string, string>(
      files
        .map((file) => [extractFileIdentifier(file.url), file.fileName] as [string, string])
        .filter(([id]) => id),
    );
    for (const index of unresolvedIndexes()) {
      const id = extractFileIdentifier(resolved[index].downloadUrl);
      const name = id ? nameByIdentifier.get(id) || "" : "";
      if (name && !isInternalMaterialName(name)) applyName(index, name);
    }
  };

  applyNamesByUrl(await fetchVisibleFileNames(tabId));

  const headIndexes = unresolvedIndexes();
  const metadataByUrl = await fetchFileMetadataBatch(
    [...new Set(headIndexes.map((index) => resolved[index].downloadUrl))],
    tabId,
  );
  for (const index of headIndexes) {
    const id = extractFileIdentifier(resolved[index].downloadUrl);
    const metadata = id ? metadataByUrl.get(id) : null;
    if (!metadata) continue;
    if (metadata.fileName && !isInternalMaterialName(metadata.fileName)) {
      applyName(index, metadata.fileName, metadata.mimeType);
    } else if (metadata.mimeType) {
      resolved[index] = { ...resolved[index], mimeType: metadata.mimeType };
    }
  }

  // Ultra page documents render at their parent folder's URL, so scan that
  // page rather than the ultraDocumentBody child (which only shows an error).
  const scanIdFor = (contentId: string) =>
    documents.get(contentId)?.parentId || contentId;
  const remainingContentIds = [...new Set(
    unresolvedIndexes()
      .map((index) => scanIdFor(resolved[index].contentId))
      .filter(Boolean),
  )];
  if (remainingContentIds.length) {
    const documentFiles = await fetchDocumentFileNames(courseId, remainingContentIds, tabId);
    applyNamesByUrl(documentFiles);
    const filesByContent = new Map<string, Array<{ fileName: string }>>();
    for (const file of documentFiles) {
      if (!file.contentId) continue;
      filesByContent.set(file.contentId, [...(filesByContent.get(file.contentId) || []), file]);
    }
    for (const index of unresolvedIndexes()) {
      const material = resolved[index];
      const scanId = scanIdFor(material.contentId);
      const siblings = unresolvedIndexes()
        .filter((other) => scanIdFor(resolved[other].contentId) === scanId);
      const candidates = filesByContent.get(scanId) || [];
      if (siblings.length === 1 && candidates.length === 1 &&
        !isInternalMaterialName(candidates[0].fileName)) {
        applyName(index, candidates[0].fileName);
      }
    }
  }

  unresolvedIndexes().forEach((index) => applyName(index, `配布資料 ${index + 1}`));
  return resolved;
}

function materialIdentity(material: CleMaterial) {
  const resourceId =
    material.downloadUrl.match(/(?:rid|xid)-(\d+)_\d+/i)?.[1] ||
    material.downloadUrl.match(/\/attachments\/_?(\d+)_\d+\/download/i)?.[1] ||
    material.attachmentId.match(/^_?(\d+)_\d+$/)?.[1];
  return resourceId
    ? `${material.contentId}:resource:${resourceId}`
    : `${material.contentId}:url:${normalizedFileUrl(material.downloadUrl)}`;
}

function preferNamedMaterial(left: CleMaterial, right: CleMaterial) {
  const leftInternal = isInternalMaterialName(left.fileName) || /^配布資料 \d+$/.test(left.fileName);
  const rightInternal = isInternalMaterialName(right.fileName) || /^配布資料 \d+$/.test(right.fileName);
  if (leftInternal !== rightInternal) return leftInternal ? right : left;
  return left.downloadUrl.includes("/bbcswebdav/") ? left : right;
}

function collectEmbeddedMaterials(
  courseId: string,
  content: JsonRecord,
  folderPath: string[],
  detail: unknown,
) {
  const materials: CleMaterial[] = [];
  const visitHtml = (body: string) => {
    if (!body.includes("href")) return;
    const document = new DOMParser().parseFromString(body, "text/html");
    document.querySelectorAll("a[href]").forEach((anchor) => {
      // Ultra documents render file anchors with an empty body; the file name
      // and MIME type live in the data-bbfile attribute as JSON (linkName).
      let bbFile: JsonRecord = {};
      try {
        bbFile = asRecord(JSON.parse(anchor.getAttribute("data-bbfile") || ""));
      } catch {
        bbFile = {};
      }
      const material = embeddedMaterial(
        courseId,
        content,
        folderPath,
        asString(bbFile.linkName) ||
          asString(bbFile.displayName) ||
          anchor.getAttribute("download") ||
          anchor.textContent?.trim() ||
          "",
        anchor.getAttribute("href") || "",
        { mimeType: asString(bbFile.mimeType) },
      );
      if (material) materials.push(material);
    });
  };
  const visitString = (value: string) => {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        visit(JSON.parse(trimmed));
        return;
      } catch {
        // Some document body strings contain HTML rather than serialized JSON.
      }
    }
    visitHtml(value);
  };
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      visitString(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as JsonRecord;
    const fileName =
      bestFileName(record) ||
      asString(record.fileName) ||
      asString(record.originalFileName) ||
      asString(record.displayName) ||
      asString(record.name);
    const url =
      asString(record.downloadUrl) ||
      asString(record.fileUrl) ||
      asString(record.url) ||
      asString(record.href);
    const material = embeddedMaterial(courseId, content, folderPath, fileName, url, record);
    if (material) materials.push(material);
    Object.values(record).forEach(visit);
  };
  visit(detail);
  visitHtml(asString(content.body));
  return materials;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const output = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      output[current] = await task(items[current]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker),
  );
  return output;
}

function normalizePageUrl(value: string, currentUrl: string) {
  const parsed = new URL(value, currentUrl);
  parsed.searchParams.sort();
  const nextUrl = parsed.toString();
  requireCleApiUrl(nextUrl);
  return nextUrl;
}

function recordIdentity(record: JsonRecord) {
  const id = asString(record.id);
  if (id) return `id:${id}`;
  const courseId = asString(record.courseId);
  const contentId = asString(record.contentId);
  if (courseId && contentId) return `course:${courseId}:content:${contentId}`;
  return "";
}

function appendUniqueRecords(
  collected: JsonRecord[],
  items: JsonRecord[],
  identities: Set<string>,
) {
  for (const item of items) {
    const identity = recordIdentity(item);
    if (identity && identities.has(identity)) continue;
    if (identity) identities.add(identity);
    collected.push(item);
  }
}

export async function fetchAllResults(
  url: string,
  tabId?: number,
  label = "CLE一覧",
  context?: CleRefreshContext,
) {
  requireCleApiUrl(url);
  const collected: JsonRecord[] = [];
  const identities = new Set<string>();
  let nextUrl = normalizePageUrl(url, url);
  const visited = new Set<string>();
  let previousPageSignature = "";
  for (let page = 0; page < MAX_API_PAGES && nextUrl; page += 1) {
    ensureRefreshTime(context);
    if (visited.has(nextUrl)) {
      throw new ClePartialResultsError(
        `${label}のページングが循環しました。以前のデータを保持します。`,
        collected,
      );
    }
    visited.add(nextUrl);
    const response = await fetchJson(nextUrl, tabId, context);
    const items = requiredResults(response, label);
    const paging = asRecord(asRecord(response).paging);
    const pageSignature = JSON.stringify(items);
    if (page > 0 && items.length && pageSignature === previousPageSignature) {
      throw new ClePartialResultsError(
        `${label}が同じページを繰り返しました。以前のデータを保持します。`,
        collected,
      );
    }
    previousPageSignature = pageSignature;
    appendUniqueRecords(collected, items, identities);
    const next = pagingNextUrl(response);
    if (next) {
      nextUrl = normalizePageUrl(next, nextUrl);
    } else if ("nextPage" in paging) {
      nextUrl = "";
    } else {
      const parsed = new URL(nextUrl);
      const limit = Number.parseInt(
        parsed.searchParams.get("limit") || String(MATERIALS_PAGE_SIZE),
        10,
      );
      if (items.length < limit || items.length === 0) {
        nextUrl = "";
        continue;
      }
      const offset = Number.parseInt(parsed.searchParams.get("offset") || "0", 10);
      parsed.searchParams.set("offset", String(offset + items.length));
      nextUrl = parsed.toString();
    }
  }
  if (nextUrl) {
    throw new ClePartialResultsError(
      `${label}は${MAX_API_PAGES}ページを超えたため中断しました。以前のデータを保持します。`,
      collected,
    );
  }
  return collected;
}

async function fetchContentChildren(courseId: string, contentId: string, tabId?: number) {
  const suffix = `/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/children?limit=${MATERIALS_PAGE_SIZE}`;
  try {
    return await fetchAllResults(`${API_ORIGIN}/public/v1${suffix}`, tabId, "資料フォルダ");
  } catch (error) {
    if (isCleAuthenticationError(error)) throw error;
    return fetchAllResults(`${API_ORIGIN}/v1${suffix}`, tabId, "資料フォルダ");
  }
}

async function fetchDocumentDetails(courseId: string, contentId: string, tabId?: number) {
  const suffix = `/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}`;
  // Ultra documents are not fully exposed by every REST version, so query both and keep what responds.
  const details = await Promise.all([
    fetchJson(`${API_ORIGIN}/public/v1${suffix}`, tabId).catch((error) => {
      if (isCleAuthenticationError(error)) throw error;
      return null;
    }),
    fetchJson(`${API_ORIGIN}/v1${suffix}`, tabId).catch((error) => {
      if (isCleAuthenticationError(error)) throw error;
      return null;
    }),
  ]);
  return details.filter((detail) => detail !== null);
}

async function fetchContentAttachments(
  courseId: string,
  content: JsonRecord,
  folderPath: string[],
  tabId?: number,
  warnings: string[] = [],
): Promise<CleMaterial[]> {
  const contentId = asString(content.id);
  if (!contentId || !contentMayHaveFiles(content)) return [];
  let attachmentMaterials: CleMaterial[] = [];
  const attachmentsSuffix = `/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/attachments`;
  // Not every Learn instance exposes attachments via the public REST API for
  // students, so fall back to the internal v1 endpoint the Ultra UI uses.
  let attachmentsBase = `${API_ORIGIN}/public/v1`;
  let attachments: JsonRecord[] = [];
  try {
    attachments = await fetchAllResults(`${attachmentsBase}${attachmentsSuffix}?limit=${MATERIALS_PAGE_SIZE}`, tabId);
  } catch (error) {
    if (isCleAuthenticationError(error)) throw error;
    try {
      attachmentsBase = `${API_ORIGIN}/v1`;
      attachments = await fetchAllResults(`${attachmentsBase}${attachmentsSuffix}?limit=${MATERIALS_PAGE_SIZE}`, tabId);
    } catch (error) {
      if (isCleAuthenticationError(error)) throw error;
      warnings.push(
        `${materialFolderName(content) || contentId}: 添付資料を取得できませんでした`,
      );
      attachments = [];
    }
  }
  attachmentMaterials = attachments
    .map((attachment): CleMaterial => {
      const attachmentId = asString(attachment.id);
      const nameCandidate =
        bestFileName(attachment) ||
        asString(attachment.fileName) ||
        asString(attachment.name);
      const fileName = nameCandidate;
      const addedAt =
        asString(content.modified) ||
        asString(content.created);
      return {
        id: `${contentId}:${attachmentId}`,
        contentId,
        attachmentId,
        title: materialFolderName(content) || fileName,
        fileName,
        mimeType: asString(attachment.mimeType) || "application/octet-stream",
        size: asNumber(attachment.size),
        addedAt,
        folderPath,
        downloadUrl: `${attachmentsBase}${attachmentsSuffix}/${encodeURIComponent(attachmentId)}/download`,
      };
    })
    .filter((material) => material.attachmentId);
  if (!isDocumentContent(content)) return attachmentMaterials;
  const details = await fetchDocumentDetails(courseId, contentId, tabId);
  return [
    ...attachmentMaterials,
    ...details.flatMap((detail) =>
      collectEmbeddedMaterials(
        courseId,
        content,
        [...folderPath, materialFolderName(content)].filter(Boolean),
        detail,
      ),
    ),
  ];
}

async function fetchMaterialChildren(
  courseId: string,
  content: JsonRecord,
  folderPath: string[],
  depth: number,
  tabId?: number,
  documents?: Map<string, CleDocumentStub>,
  warnings: string[] = [],
) {
  if (!contentHasChildren(content)) return [];
  try {
    return await fetchMaterialFolder(
      courseId,
      asString(content.id),
      [...folderPath, materialFolderName(content)].filter(Boolean),
      depth + 1,
      tabId,
      documents,
      warnings,
    );
  } catch (error) {
    if (isCleAuthenticationError(error)) throw error;
    warnings.push(
      `${materialFolderName(content) || asString(content.id)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

async function fetchMaterialFolder(
  courseId: string,
  parentContentId: string | null,
  folderPath: string[],
  depth: number,
  tabId?: number,
  documents?: Map<string, CleDocumentStub>,
  warnings: string[] = [],
): Promise<CleMaterial[]> {
  if (depth > MAX_MATERIAL_FOLDER_DEPTH) {
    warnings.push(`資料フォルダが${MAX_MATERIAL_FOLDER_DEPTH}階層を超えたため省略しました`);
    return [];
  }
  const contents = parentContentId
    ? await fetchContentChildren(courseId, parentContentId, tabId)
    : await fetchAllResults(
      `${API_ORIGIN}/public/v1/courses/${encodeURIComponent(courseId)}/contents?limit=${MATERIALS_PAGE_SIZE}`,
      tabId,
      "資料一覧",
    );
  if (documents && parentContentId) {
    for (const content of contents) {
      const contentId = asString(content.id);
      if (!contentId || !isDocumentContent(content)) continue;
      documents.set(contentId, { contentId, parentId: parentContentId });
    }
  }
  const directMaterials = await mapWithConcurrency(
    contents,
    MATERIAL_FETCH_CONCURRENCY,
    (content) => fetchContentAttachments(courseId, content, folderPath, tabId, warnings),
  );
  const childMaterials = await mapWithConcurrency(
    contents.filter(contentHasChildren),
    MATERIAL_FETCH_CONCURRENCY,
    (content) =>
      fetchMaterialChildren(courseId, content, folderPath, depth, tabId, documents, warnings),
  );
  return [...directMaterials, ...childMaterials].flat();
}

export async function fetchCourseMaterials(
  courseId: string,
  tabId?: number,
  force = false,
): Promise<CleMaterialList> {
  const cache = loadMaterialCache(courseId);
  if (!force && isMaterialCacheFresh(cache[courseId])) return cache[courseId];
  const existing = materialRequests.get(courseId);
  if (existing) return existing;
  const documents = new Map<string, CleDocumentStub>();
  const warnings: string[] = [];
  const request = (async () => {
    try {
      const materials = await fetchMaterialFolder(
        courseId,
        null,
        [],
        0,
        tabId,
        documents,
        warnings,
      );
      const namedMaterials = await resolveMaterialNames(courseId, materials, tabId, documents);
      const uniqueByResource = new Map<string, CleMaterial>();
      namedMaterials.forEach((material) => {
        const key = materialIdentity(material);
        const current = uniqueByResource.get(key);
        uniqueByResource.set(key, current ? preferNamedMaterial(current, material) : material);
      });
      const unique = [...uniqueByResource.values()]
        .sort((left, right) => {
          const dateOrder = timestampValue(right.addedAt) - timestampValue(left.addedAt);
          if (dateOrder) return dateOrder;
          const folderOrder = left.folderPath.join("/").localeCompare(right.folderPath.join("/"), "ja");
          return folderOrder || left.title.localeCompare(right.title, "ja");
        });
      const result = {
        courseId,
        materials: unique,
        updatedAt: new Date().toISOString(),
        complete: warnings.length === 0,
        warnings: [...new Set(warnings)],
      };
      // Reload before writing so simultaneous refreshes for different courses
      // do not overwrite each other's newly saved lists.
      const nextCache = { ...loadMaterialCache(courseId), [courseId]: result };
      persistMaterialCache(nextCache, courseId, warnings);
      return withMaterialCacheWarnings(result, warnings);
    } catch (error) {
      if (isCleAuthenticationError(error)) throw error;
      const cached = cache[courseId];
      if (!cached) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...cached,
        complete: false,
        warnings: [`最新の資料一覧を取得できませんでした: ${message}`],
      };
    }
  })();
  materialRequests.set(courseId, request);
  try {
    return await request;
  } finally {
    if (materialRequests.get(courseId) === request) materialRequests.delete(courseId);
  }
}

export async function downloadCourseMaterial(material: CleMaterial, filePath = material.fileName) {
  const downloadUrl = new URL(material.downloadUrl);
  if (downloadUrl.origin !== CLE_ORIGIN) {
    throw new Error("CLE以外からのダウンロードは許可されていません。");
  }
  const requestKey = `${material.id}:${filePath}`;
  const existing = downloadRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-download",
        url: material.downloadUrl,
        fileName: filePath,
      }) as Promise<CleTabMessage>,
      REQUEST_TIMEOUT_MS,
    );
    if (!result?.ok || !Number.isInteger(result.downloadId)) {
      throw new Error(result?.error || `「${material.fileName}」のダウンロードに失敗しました。拡張機能を再読み込みしてください。`);
    }
    return result.downloadId as number;
  })();
  downloadRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (downloadRequests.get(requestKey) === request) downloadRequests.delete(requestKey);
  }
}

export type CleBatchDownloadResult = {
  started: number;
  failed: Array<{ fileName: string; error: string }>;
};

export async function downloadCourseMaterialBatch(
  entries: Array<{ material: CleMaterial; filePath: string }>,
): Promise<CleBatchDownloadResult> {
  for (const entry of entries) {
    if (new URL(entry.material.downloadUrl).origin !== CLE_ORIGIN) {
      throw new Error("CLE以外からのダウンロードは許可されていません。");
    }
  }
  if (!entries.length) return { started: 0, failed: [] };
  const result = await withTimeout(
    chrome.runtime.sendMessage({
      type: "cle-download-batch",
      files: entries.map((entry) => ({
        url: entry.material.downloadUrl,
        fileName: entry.filePath,
      })),
    }) as Promise<CleTabMessage & CleBatchDownloadResult>,
    Math.max(REQUEST_TIMEOUT_MS, entries.length * 2000),
  );
  if (!result?.ok) {
    throw new Error(result?.error || "一括ダウンロードを開始できませんでした。拡張機能を再読み込みしてください。");
  }
  return {
    started: asNumber(result.started),
    failed: Array.isArray(result.failed) ? result.failed : [],
  };
}

export function resolveTaskStatus(
  attemptsResponse: unknown,
  gradeResponse: unknown,
  dueAt: string | null,
): CleTaskStatus {
  const attempts = results(attemptsResponse);
  const grade = asRecord(gradeResponse);
  const gradeStatus = asString(grade.status);
  const hasRecordedScore =
    finiteNumber(grade.score) !== null ||
    attempts.some((attempt) => finiteNumber(attempt.score) !== null);
  if (
    /graded|completed|posted/i.test(gradeStatus) ||
    attempts.some((attempt) => /graded|completed|posted/i.test(asString(attempt.status))) ||
    hasRecordedScore
  ) return "採点済み";
  if (
    attempts.some((attempt) => /needsgrading|submitted/i.test(asString(attempt.status))) ||
    /needsgrading|submitted/i.test(gradeStatus)
  ) return "提出済み";
  if (attempts.some((attempt) => /inprogress/i.test(asString(attempt.status)))) return "一時保存";
  if (attempts.length) return "提出済み";
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return "期限切れ";
  return "未着手";
}

function positiveTaskStatus(
  attemptsResponse: unknown,
  gradeResponse: unknown,
): CleTaskStatus | null {
  const status = resolveTaskStatus(attemptsResponse, gradeResponse, null);
  return ["採点済み", "提出済み", "一時保存"].includes(status)
    ? status
    : null;
}

function recordedTaskScore(attemptsResponse: unknown, gradeResponse: unknown) {
  const gradeScore = finiteNumber(asRecord(gradeResponse).score);
  if (gradeScore !== null) return gradeScore;
  for (const attempt of results(attemptsResponse)) {
    const score = finiteNumber(attempt.score);
    if (score !== null) return score;
  }
  return null;
}

export function resolveTaskStatusEvidence(options: {
  attemptsResponse: unknown;
  attemptsSucceeded: boolean;
  dueAt: string | null;
  gradeResponse: unknown;
  gradeSucceeded: boolean;
}) {
  const positive = positiveTaskStatus(
    options.attemptsSucceeded ? options.attemptsResponse : null,
    options.gradeSucceeded ? options.gradeResponse : null,
  );
  if (positive) {
    return {
      score: recordedTaskScore(
        options.attemptsSucceeded ? options.attemptsResponse : null,
        options.gradeSucceeded ? options.gradeResponse : null,
      ),
      status: positive,
      verified: true,
    };
  }
  if (!options.gradeSucceeded || !options.attemptsSucceeded) {
    return {
      score: null,
      status: null,
      verified: false,
    };
  }
  return {
    score: null,
    status: resolveTaskStatus(
      options.attemptsResponse,
      options.gradeResponse,
      options.dueAt,
    ),
    verified: true,
  };
}

function applyTaskStatus(
  task: CleTask,
  status: CleTaskStatus,
  score: number | null,
): CleTask {
  const next = {
    ...task,
    status,
    statusUpdatedAt: new Date().toISOString(),
  };
  // A successful status response can legitimately omit score (for an
  // ungraded submission). Never erase a previously posted score on that shape.
  if (score !== null) next.score = score;
  return next;
}

type TaskStatusFetchResult = {
  task: CleTask;
  verified: boolean;
};

async function fetchTaskStatus(
  task: CleTask,
  tabId?: number,
  context?: CleRefreshContext,
): Promise<TaskStatusFetchResult> {
  const path = `${API_ORIGIN}/public/v2/courses/${encodeURIComponent(task.courseId)}/gradebook/columns/${encodeURIComponent(task.id)}`;
  const gradeResult = await fetchJson(`${path}/users/me`, tabId, context)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => {
      if (isCleAuthenticationError(error)) throw error;
      return { ok: false as const, value: null };
    });
  const gradeEvidence = resolveTaskStatusEvidence({
    attemptsResponse: null,
    attemptsSucceeded: false,
    dueAt: task.dueAt,
    gradeResponse: gradeResult.value,
    gradeSucceeded: gradeResult.ok,
  });
  if (gradeEvidence.verified && gradeEvidence.status) {
    return {
      task: applyTaskStatus(
        task,
        gradeEvidence.status,
        gradeEvidence.score,
      ),
      verified: true,
    };
  }

  const attemptsResult = await fetchJson(`${path}/attempts?limit=10`, tabId, context)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => {
      if (isCleAuthenticationError(error)) throw error;
      return { ok: false as const, value: null };
    });
  const evidence = resolveTaskStatusEvidence({
    attemptsResponse: attemptsResult.value,
    attemptsSucceeded: attemptsResult.ok,
    dueAt: task.dueAt,
    gradeResponse: gradeResult.value,
    gradeSucceeded: gradeResult.ok,
  });
  if (evidence.verified && evidence.status) {
    return {
      task: applyTaskStatus(
        task,
        evidence.status,
        evidence.score,
      ),
      verified: true,
    };
  }
  return { task, verified: false };
}

export function gradebookColumnsToTasks(
  course: Pick<CleCourse, "courseId" | "name">,
  columns: JsonRecord[],
): CleTask[] {
  return columns
    .filter((item) => asString(item.contentId))
    .filter((item) => !asBoolean(item.externalGrade))
    .map((item): CleTask => {
      const dueAt = asString(asRecord(item.grading).due) || null;
      const possibleScore = finiteNumber(asRecord(item.score).possible);
      return {
        id: asString(item.id),
        courseId: course.courseId,
        courseName: course.name,
        title: asString(item.name) || asString(item.displayName),
        dueAt,
        status: dueAt && new Date(dueAt).getTime() < Date.now()
          ? "期限切れ"
          : "状態不明",
        ...(possibleScore === null ? {} : { possibleScore }),
      };
    })
    .filter((task) => task.id && task.courseId && task.title);
}

async function fetchGradebookTasks(
  courses: CleCourse[],
  previousTasks: CleTask[] = [],
  tabId?: number,
  context?: CleRefreshContext,
) {
  const candidates = courses.filter((course) => course.available !== false);
  const tasks: CleTask[] = [];
  const successfulCourseIds = new Set<string>();
  const failedCourseNames: string[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < candidates.length) {
      const course = candidates[nextIndex];
      nextIndex += 1;
      try {
        ensureRefreshTime(context);
        const params = new URLSearchParams({
          limit: String(MATERIALS_PAGE_SIZE),
          fields: "id,name,displayName,externalGrade,contentId,grading.due,score.possible",
        });
        const columns = await fetchAllResults(
          `${API_ORIGIN}/public/v2/courses/${encodeURIComponent(course.courseId)}/gradebook/columns?${params}`,
          tabId,
          `${course.name}の課題`,
          context,
        );
        const courseTasks = gradebookColumnsToTasks(course, columns);
        // A validated { results: [] } envelope is an authoritative empty
        // result, including when paging metadata is omitted. Cache fallback
        // is reserved for a rejected, malformed, or partial request below.
        tasks.push(...courseTasks);
        successfulCourseIds.add(course.courseId);
      } catch (error) {
        if (isCleAuthenticationError(error)) throw error;
        // Keep the previous cached items for a course when its gradebook is temporarily unavailable.
        failedCourseNames.push(course.name);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, candidates.length) }, worker),
  );
  return { tasks, successfulCourseIds, failedCourseNames };
}

function compareTaskDueAt(left: CleTask, right: CleTask) {
  if (!left.dueAt && !right.dueAt) return left.title.localeCompare(right.title, "ja");
  if (!left.dueAt) return 1;
  if (!right.dueAt) return -1;
  return left.dueAt.localeCompare(right.dueAt);
}

async function fetchTasks(
  courses: CleCourse[],
  previousTasks: CleTask[],
  restrictToCourses: boolean,
  tabId?: number,
  context?: CleRefreshContext,
) {
  const since = new Date(Date.now() - TASK_STATUS_WINDOW_MS).toISOString();
  const until = new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    since,
    until,
    fields: "id,type,calendarId,calendarName,title,start,end,dynamicCalendarItemProps",
  });
  params.set("limit", String(MATERIALS_PAGE_SIZE));
  const [calendarResult, gradebookResult] = await Promise.all([
    fetchAllResults(
      `${API_ORIGIN}/public/v1/calendars/items?${params}`,
      tabId,
      "CLEカレンダー",
      context,
    )
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => {
        if (isCleAuthenticationError(error)) throw error;
        return { ok: false as const, value: null };
      }),
    fetchGradebookTasks(courses, previousTasks, tabId, context),
  ]);
  const activeCourseIds = new Set(courses.map((course) => course.courseId));
  const calendarTasks = (calendarResult.value || [])
    .filter((item) => asString(item.type) === "GradebookColumn")
    .map((item): CleTask => ({
      id: asString(item.id),
      courseId: asString(item.calendarId),
      courseName: asString(item.calendarName),
      title: asString(item.title),
      dueAt: asString(item.end) || asString(item.start),
      status: new Date(asString(item.end) || asString(item.start)).getTime() < Date.now()
        ? "期限切れ"
        : "状態不明",
    }))
    .filter((task) => task.id && task.courseId && task.title && task.dueAt)
    .filter((task) => !restrictToCourses || activeCourseIds.has(task.courseId));
  const preservedCalendarTasks = !calendarResult.ok
    ? previousTasks.filter((task) => !restrictToCourses || activeCourseIds.has(task.courseId))
    : [];
  const cachedGradebookTasks = previousTasks.filter(
    (task) =>
      activeCourseIds.has(task.courseId) &&
      !gradebookResult.successfulCourseIds.has(task.courseId),
  );
  const tasksByKey = new Map<string, CleTask>();
  for (const task of [
    ...cachedGradebookTasks,
    ...preservedCalendarTasks,
    ...calendarTasks,
    ...gradebookResult.tasks,
  ]) {
    tasksByKey.set(cachedTaskKey(task), task);
  }
  return {
    tasks: [...tasksByKey.values()].sort(compareTaskDueAt),
    successful:
      calendarResult.ok ||
      gradebookResult.successfulCourseIds.size > 0,
    warnings: [
      ...(gradebookResult.failedCourseNames.length
        ? [`課題を取得できない科目が${gradebookResult.failedCourseNames.length}件あります`]
        : []),
      ...(!calendarResult.ok
        ? ["CLEカレンダーを取得できなかったため、以前の課題を保持しました"]
        : []),
    ],
  };
}

function cachedTaskKey(task: CleTask) {
  return `${task.courseId}:${task.id}`;
}

function mergeCachedTaskStatuses(tasks: CleTask[], previousTasks: CleTask[]) {
  const previousByKey = new Map(previousTasks.map((task) => [cachedTaskKey(task), task]));
  return tasks.map((task) => {
    const previous = previousByKey.get(cachedTaskKey(task));
    return previous && previous.status !== "状態不明"
      ? {
        ...task,
        status: previous.status,
        score: previous.score,
        possibleScore: task.possibleScore ?? previous.possibleScore,
        statusUpdatedAt: previous.statusUpdatedAt,
      }
      : task;
  });
}

function taskStatusTtl(task: CleTask) {
  if (task.status === "採点済み") return GRADED_STATUS_TTL_MS;
  if (task.status === "提出済み") return 6 * 60 * 60 * 1000;
  if (task.status === "期限切れ") return 24 * 60 * 60 * 1000;
  return CLE_TASK_STATUSES_TTL_MS;
}

function taskStatusPriority(task: CleTask, now: number) {
  const dueAt = task.dueAt ? new Date(task.dueAt).getTime() : null;
  if (dueAt === null) return 2 * TASK_STATUS_WINDOW_MS;
  const distance = dueAt - now;
  const unresolved = !["提出済み", "採点済み", "期限切れ"].includes(task.status);
  if (unresolved && distance >= 0 && distance <= 24 * 60 * 60 * 1000) {
    return distance;
  }
  if (unresolved && distance >= 0) return 24 * 60 * 60 * 1000 + distance;
  if (task.status === "提出済み") return 2 * TASK_STATUS_WINDOW_MS + Math.abs(distance);
  return 3 * TASK_STATUS_WINDOW_MS + Math.abs(distance);
}

export function selectTaskStatusTargets(
  tasks: CleTask[],
  options: {
    force: boolean;
    cursor?: number;
    priorityCourseId?: string;
    now?: number;
  },
) {
  const now = options.now ?? Date.now();
  const limit = options.force
    ? FORCED_STATUS_TASK_LIMIT
    : NORMAL_STATUS_TASK_LIMIT;
  const candidates = tasks
    .filter((task) => {
      if (!task.dueAt) return true;
      const dueAt = new Date(task.dueAt).getTime();
      if (!Number.isFinite(dueAt)) return true;
      if (task.status === "提出済み") return true;
      if (
        options.force &&
        options.priorityCourseId &&
        task.courseId === options.priorityCourseId
      ) {
        return true;
      }
      return dueAt >= now - TASK_STATUS_LOOKBACK_MS &&
        dueAt <= now + TASK_STATUS_WINDOW_MS;
    })
    .filter((task) =>
      options.force || !isFreshAt(task.statusUpdatedAt, taskStatusTtl(task), now),
    )
    .sort((left, right) => {
      const leftFocused = left.courseId === options.priorityCourseId ? 0 : 1;
      const rightFocused = right.courseId === options.priorityCourseId ? 0 : 1;
      return leftFocused - rightFocused ||
        taskStatusPriority(left, now) - taskStatusPriority(right, now) ||
        cachedTaskKey(left).localeCompare(cachedTaskKey(right));
    });
  if (!options.force || candidates.length <= limit) {
    return {
      targets: candidates.slice(0, limit),
      nextCursor: options.force ? 0 : Math.max(0, options.cursor || 0),
      candidateCount: candidates.length,
    };
  }
  const start = Math.max(0, options.cursor || 0) % candidates.length;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  const targets = rotated.slice(0, limit);
  return {
    targets,
    nextCursor: (start + targets.length) % candidates.length,
    candidateCount: candidates.length,
  };
}

async function refreshTaskStatuses(
  tasks: CleTask[],
  tabId?: number,
  force = false,
  cursor = 0,
  priorityCourseId = "",
  context?: CleRefreshContext,
) {
  const selection = selectTaskStatusTargets(tasks, {
    force,
    cursor,
    priorityCourseId,
  });
  const statuses = new Map<string, CleTask>();
  let verifiedCount = 0;
  let failedCount = 0;
  const results = await mapWithConcurrency(
    selection.targets,
    SYNC_CONCURRENCY,
    async (task) => {
      try {
        ensureRefreshTime(context);
        return { result: await fetchTaskStatus(task, tabId, context), error: null };
      } catch (error) {
        if (isCleAuthenticationError(error)) throw error;
        return { result: { task, verified: false }, error };
      }
    },
  );
  for (const entry of results) {
    statuses.set(cachedTaskKey(entry.result.task), entry.result.task);
    if (entry.result.verified) verifiedCount += 1;
    if (entry.error) failedCount += 1;
  }
  return {
    tasks: tasks.map((task) => statuses.get(cachedTaskKey(task)) || task),
    nextCursor: selection.nextCursor,
    targetCount: selection.targets.length,
    verifiedCount,
    failedCount,
    pendingCount: Math.max(
      0,
      selection.candidateCount - verifiedCount,
    ),
  };
}

export type MessagePartialReason = "budget" | "rate-limit" | "error" | "pagination";

export type MessageFetchResult = {
  messages: CleMessageCourse[];
  complete: boolean;
  nextPage: string | null;
  pendingCount: number;
  reason: MessagePartialReason | null;
  seenCourseIds?: string[];
  retryAfterMs?: number;
  warning?: string;
};

function sortMessages(messages: CleMessageCourse[]) {
  return [...messages].sort(
    (left, right) => right.unreadCount - left.unreadCount ||
      left.courseId.localeCompare(right.courseId),
  );
}

function mergeMessages(
  previous: CleMessageCourse[],
  fetched: CleMessageCourse[],
  complete: boolean,
  seenCourseIds: Iterable<string> = [],
  preservePrevious = false,
) {
  if (complete && !preservePrevious) return sortMessages(fetched);
  const byCourse = new Map(previous.map((message) => [message.courseId, message]));
  for (const courseId of seenCourseIds) byCourse.delete(courseId);
  fetched.forEach((message) => byCourse.set(message.courseId, message));
  return sortMessages([...byCourse.values()]);
}

function messageSummaryUrl(offset = 0) {
  return normalizePageUrl(
    `${API_ORIGIN}/v1/messages/summary?offset=${offset}&limit=${MESSAGE_PAGE_SIZE}`,
    CLE_ORIGIN,
  );
}

function validateMessageCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const normalized = normalizePageUrl(value, CLE_ORIGIN);
    const parsed = new URL(normalized);
    if (parsed.pathname !== MESSAGE_SUMMARY_PATH) return null;
    const offsetValue = parsed.searchParams.get("offset");
    const limitValue = parsed.searchParams.get("limit");
    if (offsetValue !== null) {
      if (!/^\d+$/.test(offsetValue)) return null;
      const offset = Number(offsetValue);
      if (!Number.isSafeInteger(offset)) return null;
    }
    if (limitValue !== null) {
      if (!/^\d+$/.test(limitValue)) return null;
      const limit = Number(limitValue);
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MESSAGE_PAGE_SIZE) return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function messageCursorOffset(value: string) {
  const parsed = new URL(value);
  const raw = parsed.searchParams.get("offset");
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const offset = Number(raw);
  return Number.isSafeInteger(offset) ? offset : null;
}

function messageRecoveryCursor(currentUrl: string, itemCount: number) {
  const currentOffset = messageCursorOffset(currentUrl);
  if (currentOffset === null || itemCount <= 0) return null;
  const nextOffset = currentOffset + itemCount;
  return Number.isSafeInteger(nextOffset) ? messageSummaryUrl(nextOffset) : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function messagePageIdSignature(items: JsonRecord[]) {
  const ids = [...new Set(
    items
      .map((item) => asString(item.courseId))
      .filter(Boolean),
  )].sort();
  return ids.length ? JSON.stringify(ids) : null;
}

function messageUnreadCount(item: JsonRecord) {
  if (!Object.prototype.hasOwnProperty.call(item, "numUnreadMessages")) return 0;
  const raw = item.numUnreadMessages;
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function requiredMessageResults(value: unknown) {
  const items = asRecord(value).results;
  if (!Array.isArray(items)) {
    throw new Error("CLEメッセージの応答形式を確認できませんでした。以前のデータを保持します。");
  }
  const records: JsonRecord[] = [];
  for (const item of items) {
    if (!isJsonRecord(item) || !asString(item.courseId).trim()) {
      throw new Error("CLEメッセージの科目情報が不正だったため、以前のデータを保持します。");
    }
    if (messageUnreadCount(item) === null) {
      throw new Error("CLEメッセージの未読数が不正だったため、以前のデータを保持します。");
    }
    records.push(item);
  }
  return records;
}

export async function fetchMessages(
  tabId?: number,
  previous: CleMessageCourse[] = [],
  context?: CleRefreshContext,
  resumeCursor?: string | null,
): Promise<MessageFetchResult> {
  const messages = new Map<string, CleMessageCourse>();
  const seenCourseIds = new Set<string>();
  const firstUrl = messageSummaryUrl(0);
  const resumeUrl = validateMessageCursor(resumeCursor);
  const cursorWasInvalid = Boolean(resumeCursor && !resumeUrl);
  const cursorWarning = cursorWasInvalid
    ? "メッセージの続きカーソルが不正だったため、先頭から再開しました。"
    : "";
  const resumedFromCursor = Boolean(resumeUrl && resumeUrl !== firstUrl);
  let nextUrl = firstUrl;
  let nextAfterHead = resumeUrl && resumeUrl !== firstUrl ? resumeUrl : null;
  let scannedPages = 0;
  const visited = new Set<string>();
  const pageSignatures = new Set<string>();
  let awaitingRecovery = false;
  let recoverySourceUrl: string | null = null;

  const partial = (
    nextPage: string | null,
    reason: MessagePartialReason,
    warning: string,
    retryAfterMs = 0,
  ): MessageFetchResult => ({
    messages: mergeMessages(previous, [...messages.values()], false, seenCourseIds),
    complete: false,
    nextPage: validateMessageCursor(nextPage),
    pendingCount: 1,
    reason,
    seenCourseIds: [...seenCourseIds],
    retryAfterMs,
    warning: [cursorWarning, warning].filter(Boolean).join(" "),
  });
  const complete = (): MessageFetchResult => ({
    messages: mergeMessages(
      previous,
      [...messages.values()],
      true,
      seenCourseIds,
      resumedFromCursor,
    ),
    complete: true,
    nextPage: null,
    pendingCount: 0,
    reason: null,
    seenCourseIds: [...seenCourseIds],
    warning: cursorWarning || undefined,
  });

  for (let page = 0; page < MAX_MESSAGE_PAGES && nextUrl; page += 1) {
    try {
      ensureRefreshTime(context);
    } catch (error) {
      // A bounded refresh deadline is expected during a large message list.
      // Return the next validated cursor so the caller can resume instead of
      // throwing away pages that were already verified in this run.
      if (scannedPages > 0 && error instanceof CleDeadlineError) {
        return partial(
          awaitingRecovery ? recoverySourceUrl : nextUrl,
          "budget",
          "CLEメッセージの取得時間上限に達したため、取得済み分だけを保持します。",
        );
      }
      throw error;
    }
    if (visited.has(nextUrl)) {
      return partial(
        null,
        "pagination",
        "メッセージのページングカーソルが循環したため、取得済み分だけを保持しました。",
      );
    }
    visited.add(nextUrl);
    let response: unknown;
    try {
      response = await fetchJson(nextUrl, tabId, context);
    } catch (error) {
      if (isCleAuthenticationError(error)) throw error;
      if (scannedPages > 0) {
        return partial(
          awaitingRecovery ? recoverySourceUrl : nextUrl,
          error instanceof CleDeadlineError
            ? "budget"
            : error instanceof CleRequestError && error.status === 429
              ? "rate-limit"
              : "error",
          error instanceof CleDeadlineError
            ? "CLEメッセージの取得時間上限に達したため、取得済み分だけを保持します。"
            : `メッセージの途中取得に失敗したため、取得済み分だけを保持しました: ${error instanceof Error ? error.message : String(error)}`,
          retryAfterFromError(error),
        );
      }
      throw error;
    }
    let items: JsonRecord[];
    try {
      items = requiredMessageResults(response);
    } catch (error) {
      if (scannedPages > 0) {
        return partial(
          awaitingRecovery ? recoverySourceUrl : nextUrl,
          "error",
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }

    const responseRecord = asRecord(response);
    const hasPagingField = Object.prototype.hasOwnProperty.call(responseRecord, "paging");
    const rawPaging = hasPagingField ? responseRecord.paging : undefined;
    const pagingIsValid = !hasPagingField || isJsonRecord(rawPaging);
    const paging = pagingIsValid ? rawPaging as JsonRecord | undefined : undefined;
    const hasNextPageField = Boolean(
      paging && Object.prototype.hasOwnProperty.call(paging, "nextPage"),
    );
    const rawNextPage = hasNextPageField ? paging?.nextPage : undefined;
    const explicitEnd = rawNextPage === null || rawNextPage === "";
    const nextPageIsValid = !hasNextPageField || explicitEnd || (
      typeof rawNextPage === "string" && rawNextPage.trim().length > 0
    );

    const currentSignature = messagePageIdSignature(items);
    const repeatedPage = Boolean(currentSignature && pageSignatures.has(currentSignature));
    if (currentSignature) pageSignatures.add(currentSignature);
    const contributesNewCourse = awaitingRecovery && items.some((item) => {
      const courseId = asString(item.courseId);
      return Boolean(courseId && !seenCourseIds.has(courseId));
    });

    // The result rows are valid even when paging metadata is not. Apply them
    // before returning the partial result so a malformed cursor cannot erase
    // a page that was already fetched successfully.
    scannedPages += 1;
    for (const item of items) {
      const courseId = asString(item.courseId);
      if (!courseId) continue;
      seenCourseIds.add(courseId);
      const unreadCount = messageUnreadCount(item) || 0;
      if (unreadCount <= 0) {
        // A later zero count is authoritative for a course already observed
        // with unread messages. Leaving the old map entry would keep stale
        // unread badges after a valid page reports it as read.
        messages.delete(courseId);
        continue;
      }
      messages.set(courseId, {
        courseId,
        courseName: asString(item.courseName) || "CLE科目",
        unreadCount,
      });
    }

    if (!pagingIsValid) {
      return partial(
        nextUrl,
        "pagination",
        "CLEメッセージのページ情報が不正だったため、取得済み分だけを保持しました。",
      );
    }
    if (!nextPageIsValid) {
      return partial(
        nextUrl,
        "pagination",
        "CLEメッセージの次ページ情報が不正だったため、取得済み分だけを保持しました。",
      );
    }
    if (repeatedPage) {
      return partial(
        awaitingRecovery ? recoverySourceUrl : null,
        "pagination",
        "メッセージの同じ内容（科目一覧）が繰り返されたため、取得済み分だけを保持しました。",
      );
    }

    if (awaitingRecovery) {
      // An empty page with an explicit end marker (or no paging metadata at
      // all) is a valid terminal response, including when it was reached via
      // a recovery cursor. A non-empty page must still prove progress.
      if (!items.length && (explicitEnd || !hasNextPageField)) {
        awaitingRecovery = false;
        recoverySourceUrl = null;
        return complete();
      }
      awaitingRecovery = false;
      if (!contributesNewCourse) {
        return partial(
          recoverySourceUrl || nextUrl,
          "pagination",
          "CLEメッセージの循環回復先に新しい科目がなかったため、取得済み分だけを保持しました。",
        );
      }
      recoverySourceUrl = null;
    }

    const rawNext = hasNextPageField && typeof rawNextPage === "string"
      ? rawNextPage
      : "";
    let pageNextUrl: string | null = null;
    if (rawNext) {
      pageNextUrl = validateMessageCursor(rawNext);
      if (!pageNextUrl) {
        return partial(
          nextUrl,
          "pagination",
          "CLEメッセージの次ページURLが不正だったため、そこで停止しました。",
        );
      }
      const currentOffset = messageCursorOffset(nextUrl);
      const nextOffset = pageNextUrl === null ? null : messageCursorOffset(pageNextUrl);
      if (
        currentOffset !== null &&
        nextOffset !== null &&
        nextOffset <= currentOffset
      ) {
        // CLE has occasionally returned a stale/self-looping nextPage. The
        // offset derived from the received item count is safe to try, and a
        // recovery is accepted only after its response contributes a new
        // course ID. This allows more than one recovery in a bounded scan.
        const recoveryUrl = items.length > 0
          ? messageRecoveryCursor(nextUrl, items.length)
          : null;
        if (recoveryUrl && !visited.has(recoveryUrl)) {
          awaitingRecovery = true;
          recoverySourceUrl = nextUrl;
          pageNextUrl = recoveryUrl;
        } else {
          return partial(
            null,
            "pagination",
            "CLEメッセージの次ページカーソルが前進しなかったため、取得済み分だけを保持しました。",
          );
        }
      }
    } else if (hasNextPageField) {
      pageNextUrl = null;
    } else if (items.length > 0) {
      // The endpoint may honor a smaller page size while omitting paging.
      // Continue by the number of rows received; an empty response is the
      // only implicit terminal marker.
      pageNextUrl = messageRecoveryCursor(nextUrl, items.length);
      if (!pageNextUrl) {
        return partial(
          nextUrl,
          "pagination",
          "CLEメッセージの続き位置を確認できなかったため、取得済み分だけを保持しました。",
        );
      }
    }

    if (scannedPages === 1 && nextAfterHead) {
      // Always scan the head page, then spend the remaining budget at the
      // cursor saved by the previous partial run.
      if (awaitingRecovery) {
        // A known persisted cursor is preferable to a recovery cursor derived
        // from the head response. It was not requested, so do not treat it as
        // an awaited recovery result.
        awaitingRecovery = false;
        recoverySourceUrl = null;
      }
      nextUrl = nextAfterHead;
      nextAfterHead = null;
    } else {
      nextUrl = pageNextUrl || "";
    }
    if (!nextUrl) {
      return complete();
    }
  }

  return partial(
    awaitingRecovery ? recoverySourceUrl : nextUrl,
    "budget",
    `CLEメッセージの取得上限（${MAX_MESSAGE_PAGES}ページ）に達したため、次回は続きから再開します。`,
  );
}

async function fetchCourses(tabId?: number, context?: CleRefreshContext) {
  const items = await fetchAllResults(
    `${API_ORIGIN}/public/v1/users/me/courses?limit=100&expand=course`,
    tabId,
    "CLEコース",
    context,
  );
  return items
    .map((item): CleCourse => {
      const course = asRecord(item.course);
      const courseId = asString(item.courseId) || asString(course.id);
      const displayId =
        asString(course.courseId) ||
        asString(course.externalId) ||
        asString(item.courseId);
      const itemAvailability = asRecord(item.availability).available;
      const courseAvailability = course.availability ? asRecord(course.availability).available : undefined;
      const isAvailable =
        (itemAvailability === undefined || isYes(itemAvailability)) &&
        (courseAvailability === undefined || isYes(courseAvailability));
      return {
        courseId,
        displayId,
        timetableCode: courseCodeFromDisplayId(displayId),
        name: asString(course.name) || asString(item.name) || displayId,
        available: isAvailable,
      };
    })
    .filter((course) => course.courseId && course.name)
    .sort((left, right) => left.displayId.localeCompare(right.displayId));
}

async function fetchAnnouncements(
  course: CleCourse,
  tabId?: number,
  context?: CleRefreshContext,
): Promise<CleAnnouncement[]> {
  const items = await fetchAllResults(
    `${API_ORIGIN}/public/v1/courses/${encodeURIComponent(course.courseId)}/announcements?limit=${MATERIALS_PAGE_SIZE}`,
    tabId,
    `${course.name}の連絡事項`,
    context,
  );
  return items.map((item): CleAnnouncement => ({
    id: asString(item.id),
    courseId: asString(item.courseId) || course.courseId,
    courseName: course.name,
    title: asString(item.title),
    body: asString(item.body),
    created: asString(item.created),
  }));
}

async function refreshAnnouncements(
  courses: CleCourse[],
  previous: Record<string, CleAnnouncementCourseCache>,
  recentCourseIds: Set<string>,
  priorityCourseCode: string,
  tabId?: number,
  context?: CleRefreshContext,
) {
  const limit = 3;
  const cache = { ...previous };
  const now = Date.now();
  const candidates = courses
    .filter((course) => {
      const entry = cache[course.courseId];
      if (entry?.nextRetryAt && entry.nextRetryAt > now) return false;
      return !isFresh(entry?.updatedAt, CLE_ANNOUNCEMENTS_TTL_MS);
    })
    .sort((left, right) => {
      const leftPriority = left.timetableCode === priorityCourseCode
        ? 0
        : recentCourseIds.has(left.courseId) ? 1 : 2;
      const rightPriority = right.timetableCode === priorityCourseCode
        ? 0
        : recentCourseIds.has(right.courseId) ? 1 : 2;
      return leftPriority - rightPriority || left.displayId.localeCompare(right.displayId);
    })
    .slice(0, MAX_ANNOUNCEMENT_COURSES_PER_REFRESH);
  let index = 0;

  async function worker() {
    while (index < candidates.length) {
      const course = candidates[index++];
      if (!course) break;
      try {
        ensureRefreshTime(context);
        const announcements = await fetchAnnouncements(course, tabId, context);
        const old = cache[course.courseId];
        if (!announcements.length && (old?.announcements.length || 0) > 0) {
          throw new CleRequestError(
            `${course.name}の連絡事項が空応答だったため、以前のデータを保持します。`,
            { retryable: true },
          );
        }
        cache[course.courseId] = {
          announcements,
          updatedAt: new Date().toISOString(),
          failureCount: 0,
          nextRetryAt: 0,
        };
      } catch (error) {
        if (isCleAuthenticationError(error)) throw error;
        const old = cache[course.courseId];
        const failureCount = (old?.failureCount || 0) + 1;
        const base = 60 * 1000 * (2 ** Math.min(failureCount - 1, 6));
        const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base / 4)));
        const delay = Math.min(
          60 * 60 * 1000,
          Math.max(base + jitter, retryAfterFromError(error)),
        );
        cache[course.courseId] = {
          announcements: old?.announcements || [],
          updatedAt: old?.updatedAt || null,
          failureCount,
          nextRetryAt: Date.now() + delay,
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(SYNC_CONCURRENCY, candidates.length) }, worker);
  await Promise.all(workers);
  const activeIds = new Set(courses.map((course) => course.courseId));
  for (const courseId of Object.keys(cache)) {
    if (!activeIds.has(courseId)) delete cache[courseId];
  }
  const announcements = courses
    .flatMap((course) => cache[course.courseId]?.announcements || [])
    .sort((left, right) => right.created.localeCompare(left.created));
  const updatedAt = latestTimestamp(
    courses.map((course) => cache[course.courseId]?.updatedAt),
  );
  const pendingCount = courses.filter((course) =>
    !isFresh(cache[course.courseId]?.updatedAt, CLE_ANNOUNCEMENTS_TTL_MS)
  ).length;
  return { announcements, cache, updatedAt, pendingCount };
}

export function getCleRetryAt() {
  return Math.max(
    readTimestamp(CLE_ATTEMPT_KEY) + MANUAL_REFRESH_TTL_MS,
    readFailureState(CLE_FAILURE_KEY).nextRetryAt,
    readTimestamp(CLE_LEASE_KEY),
  );
}

export async function refreshCle(
  previous?: CleData | null,
  tabId?: number,
  onProgress?: (value: string) => void,
  force = false,
  options: CleRefreshOptions = {},
): Promise<CleData> {
  if (!options.bypassBackoff && !force) requireRetryAvailable(CLE_FAILURE_KEY, "CLE更新");
  // A single retry after successful reauthentication must not be rejected by
  // the timestamp written by the unauthorized request itself.
  if (!force && !options.bypassBackoff) {
    requireCooldown(CLE_ATTEMPT_KEY, 60 * 1000, "CLE更新の再試行は1分後にできます。");
  }
  const release = acquireLease();
  writeCoordinationValue(CLE_ATTEMPT_KEY, String(Date.now()));
  const context: CleRefreshContext = {
    deadlineAt: Date.now() + CLE_REFRESH_DEADLINE_MS,
  };
  try {
    onProgress?.("CLEキャッシュを確認中");
    const completed = new Set<string>();
    const warnings: string[] = [];
    const markDone = (label: string) => {
      completed.add(label);
      onProgress?.(`${[...completed].join(" / ")} 取得済み`);
    };
    const now = new Date().toISOString();
    const coursesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "coursesUpdatedAt"), CLE_COURSES_TTL_MS);
    const tasksFresh = !force &&
      previous?.taskScopeVersion === CLE_TASK_SCOPE_VERSION &&
      isFresh(clePartUpdatedAt(previous, "tasksUpdatedAt"), options.refreshRecent ? MANUAL_REFRESH_TTL_MS : CLE_TASKS_TTL_MS);
    const messagesTtl = options.refreshRecent
      ? MANUAL_REFRESH_TTL_MS
      : options.messagesFocused
      ? CLE_MESSAGES_FOCUSED_TTL_MS
      : CLE_MESSAGES_TTL_MS;
    const previousMessagesComplete =
      previous?.messagesComplete !== false &&
      (previous?.messagesPendingCount || 0) === 0;
    const messagesFresh = !force &&
      previousMessagesComplete &&
      isFresh(clePartUpdatedAt(previous, "messagesUpdatedAt"), messagesTtl);
    const taskStatusesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "taskStatusesUpdatedAt"), options.refreshRecent ? MANUAL_REFRESH_TTL_MS : CLE_TASK_STATUSES_TTL_MS);
    const activeCourses = options.activeCourses || [];
    const coursesPromise = coursesFresh || (!force && !retryAvailable(CLE_COURSES_FAILURE_KEY))
      ? Promise.resolve({
        courses: previous?.courses || [],
        updatedAt: clePartUpdatedAt(previous, "coursesUpdatedAt"),
      }).then((result) => {
        if (!coursesFresh) warnings.push("コース: 再試行待機中のため以前のデータを使用");
        markDone("コースキャッシュ");
        return result;
      })
      : fetchCourses(tabId, context)
        .then((courses) => {
          if (!courses.length && (previous?.courses.length || 0) > 0) {
            throw new CleRequestError(
              "CLEコースが空応答だったため、以前のデータを保持します。",
              { retryable: true },
            );
          }
          removeCoordinationValue(CLE_COURSES_FAILURE_KEY);
          markDone("コース");
          return { courses, updatedAt: now };
        })
        .catch((error) => {
          if (isCleAuthenticationError(error)) throw error;
          recordFailure(CLE_COURSES_FAILURE_KEY, retryAfterFromError(error));
          warnings.push(`コース: ${error instanceof Error ? error.message : String(error)}`);
          markDone("コースキャッシュ");
          return {
            courses: previous?.courses || [],
            updatedAt: clePartUpdatedAt(previous, "coursesUpdatedAt"),
          };
        });
    const [taskResult, messagesResult, coursesResult] = await Promise.all([
      tasksFresh || (!force && !retryAvailable(CLE_TASKS_FAILURE_KEY))
        ? Promise.resolve({
          tasks: previous?.tasks || [],
          updatedAt: clePartUpdatedAt(previous, "tasksUpdatedAt"),
        }).then((result) => {
          if (!tasksFresh) warnings.push("課題: 再試行待機中のため以前のデータを使用");
          markDone("課題キャッシュ");
          return result;
        })
        : coursesPromise
          .then(({ courses }) => {
            const resolvedCourses = resolveActiveCleCourses(courses, activeCourses);
            if (activeCourses.length && courses.length && !resolvedCourses.length) {
              throw new Error("KOANの履修科目とCLEコースを対応付けできませんでした。");
            }
            return fetchTasks(
              resolvedCourses,
              previous?.tasks || [],
              activeCourses.length > 0,
              tabId,
              context,
            );
          })
          .then((result) => {
            warnings.push(...result.warnings);
            if (result.successful) {
              if (result.warnings.length) {
                recordFailure(CLE_TASKS_FAILURE_KEY);
                markDone("課題一部");
                return {
                  tasks: result.tasks,
                  updatedAt: clePartUpdatedAt(previous, "tasksUpdatedAt"),
                };
              }
              removeCoordinationValue(CLE_TASKS_FAILURE_KEY);
              markDone("課題");
              return { tasks: result.tasks, updatedAt: now };
            }
            recordFailure(CLE_TASKS_FAILURE_KEY);
            markDone("課題キャッシュ");
            return {
              tasks: result.tasks,
              updatedAt: clePartUpdatedAt(previous, "tasksUpdatedAt"),
            };
          })
          .catch((error) => {
            if (isCleAuthenticationError(error)) throw error;
            recordFailure(CLE_TASKS_FAILURE_KEY, retryAfterFromError(error));
            warnings.push(`課題: ${error instanceof Error ? error.message : String(error)}`);
            markDone("課題キャッシュ");
            return {
              tasks: previous?.tasks || [],
              updatedAt: clePartUpdatedAt(previous, "tasksUpdatedAt"),
            };
          }),
      messagesFresh || (!force && !retryAvailable(CLE_MESSAGES_FAILURE_KEY))
        ? Promise.resolve({
          messages: previous?.messages || [],
          updatedAt: clePartUpdatedAt(previous, "messagesUpdatedAt"),
          nextPage: previous?.messagesNextPage || null,
          complete: previousMessagesComplete,
          pendingCount: previous?.messagesPendingCount || 0,
        }).then((result) => {
          if (!messagesFresh) warnings.push("メッセージ: 再試行待機中のため以前のデータを使用");
          markDone("メッセージキャッシュ");
          return result;
        })
        : fetchMessages(
          tabId,
          previous?.messages || [],
          context,
          previousMessagesComplete ? null : previous?.messagesNextPage,
        ).then((result) => {
          if (result.warning) warnings.push(`メッセージ: ${result.warning}`);
          if (!result.complete) {
            if (result.reason === "budget") {
              // Reaching the bounded scan budget is normal progress, not a
              // transport failure. Keep the resume cursor without poisoning
              // the retry backoff used for rate limits and outages.
              removeCoordinationValue(CLE_MESSAGES_FAILURE_KEY);
            } else {
              recordFailure(CLE_MESSAGES_FAILURE_KEY, result.retryAfterMs);
            }
            markDone("メッセージ一部");
            return {
              messages: result.messages,
              updatedAt: clePartUpdatedAt(previous, "messagesUpdatedAt"),
              nextPage: result.nextPage,
              complete: false,
              pendingCount: result.pendingCount,
            };
          }
          removeCoordinationValue(CLE_MESSAGES_FAILURE_KEY);
          markDone("メッセージ");
          return {
            messages: result.messages,
            updatedAt: now,
            nextPage: result.nextPage,
            complete: true,
            pendingCount: result.pendingCount,
          };
        }).catch((error) => {
          if (isCleAuthenticationError(error)) throw error;
          recordFailure(CLE_MESSAGES_FAILURE_KEY, retryAfterFromError(error));
          warnings.push(`メッセージ: ${error instanceof Error ? error.message : String(error)}`);
          markDone("メッセージキャッシュ");
          return {
            messages: previous?.messages || [],
            updatedAt: clePartUpdatedAt(previous, "messagesUpdatedAt"),
            nextPage: previous?.messagesNextPage || null,
            // A failed refresh must invalidate a previously complete cache;
            // otherwise its recent timestamp can make the next refresh look
            // fresh and suppress the retry that is needed to recover it.
            complete: false,
            pendingCount: Math.max(1, previous?.messagesPendingCount || 0),
          };
        }),
      coursesPromise,
    ]);
    let tasks = mergeCachedTaskStatuses(taskResult.tasks, previous?.tasks || []);
    const messages = messagesResult.messages;
    const courses = coursesResult.courses;
    const coursesUpdatedAt = coursesResult.updatedAt;
    const priorityCourseId = resolveActiveCleCourses(courses, activeCourses)
      .find((course) => course.timetableCode === options.priorityCourseCode)
      ?.courseId || "";
    const statusResult = await refreshTaskStatuses(
      tasks,
      tabId,
      force,
      previous?.taskStatusCursor || 0,
      priorityCourseId,
      context,
    );
    tasks = statusResult.tasks;
    let taskStatusesUpdatedAt = clePartUpdatedAt(previous, "taskStatusesUpdatedAt");
    if (statusResult.targetCount === 0) {
      taskStatusesUpdatedAt = taskStatusesFresh
        ? taskStatusesUpdatedAt
        : now;
      markDone("状態キャッシュ");
    } else if (statusResult.verifiedCount > 0) {
      taskStatusesUpdatedAt = now;
      markDone("状態");
    } else {
      markDone("状態キャッシュ");
    }
    if (statusResult.pendingCount > 0) {
      warnings.push(`課題状態: 残り${statusResult.pendingCount}件`);
      taskStatusesUpdatedAt = clePartUpdatedAt(previous, "taskStatusesUpdatedAt");
    }
    if (statusResult.failedCount > 0) {
      warnings.push(`課題状態: ${statusResult.failedCount}件の取得に失敗しました`);
    }

    const recentCourseIds = new Set([
      ...tasks.map((task) => task.courseId),
      ...messages.map((message) => message.courseId),
    ]);
    const resolvedActiveIds = new Set(
      resolveActiveCleCourses(courses, activeCourses).map((course) => course.courseId),
    );
    const announcementCourses = courses.filter((course) =>
      activeCourses.length
        ? resolvedActiveIds.has(course.courseId)
        : recentCourseIds.has(course.courseId),
    );
    onProgress?.("連絡事項を取得中");
    const announcementResult =
      activeCourses.length && courses.length && !resolvedActiveIds.size
        ? {
          announcements: previous?.announcements || [],
          cache: previous?.announcementCourses || {},
          updatedAt: clePartUpdatedAt(previous, "announcementsUpdatedAt"),
          pendingCount: Math.max(1, activeCourses.length),
        }
        : await refreshAnnouncements(
          announcementCourses,
          previous?.announcementCourses || {},
          recentCourseIds,
          options.priorityCourseCode || "",
          tabId,
          context,
        );
    const announcements = announcementResult.announcements;
    const announcementsUpdatedAt = announcementResult.updatedAt;
    if (announcementResult.pendingCount > 0) {
      warnings.push(`連絡事項: 残り${announcementResult.pendingCount}科目`);
    }
    markDone("連絡事項");

    onProgress?.("取得結果を整理中");
    const tasksUpdatedAt = taskResult.updatedAt;
    const messagesUpdatedAt = messagesResult.updatedAt;
    removeCoordinationValue(CLE_FAILURE_KEY);
    return {
      courses,
      tasks,
      messages,
      unreadMessages: messages.reduce((sum, item) => sum + item.unreadCount, 0),
      announcements,
      updatedAt: latestTimestamp([coursesUpdatedAt, tasksUpdatedAt, messagesUpdatedAt, taskStatusesUpdatedAt, announcementsUpdatedAt]),
      coursesUpdatedAt,
      tasksUpdatedAt,
      messagesUpdatedAt,
      messagesNextPage: messagesResult.nextPage,
      messagesComplete: messagesResult.complete,
      messagesPendingCount: messagesResult.pendingCount,
      taskStatusesUpdatedAt,
      taskScopeVersion: CLE_TASK_SCOPE_VERSION,
      taskStatusCursor: statusResult.nextCursor,
      announcementsUpdatedAt,
      announcementCourses: announcementResult.cache,
      announcementsPendingCount: announcementResult.pendingCount,
      taskStatusPendingCount: statusResult.pendingCount,
      warnings,
    };
  } catch (error) {
    recordFailure(CLE_FAILURE_KEY);
    throw error;
  } finally {
    onProgress?.("");
    release();
  }
}

export function cleTaskUrl(task: CleTask) {
  return `${CLE_ORIGIN}/ultra/courses/${encodeURIComponent(task.courseId)}/grades`;
}

export function cleMessageUrl(courseId: string) {
  return `${CLE_ORIGIN}/ultra/courses/${encodeURIComponent(courseId)}/messages`;
}

export function cleCourseUrl(courseId: string) {
  return `${CLE_ORIGIN}/ultra/courses/${encodeURIComponent(courseId)}/outline`;
}

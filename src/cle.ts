const CLE_ORIGIN = "https://www.cle.osaka-u.ac.jp";
const API_ORIGIN = `${CLE_ORIGIN}/learn/api`;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_MESSAGE_PAGES = 8;
const MESSAGE_PAGE_SIZE = 100;
const TASK_STATUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STATUS_REQUESTS = 12;
const MAX_ANNOUNCEMENT_COURSES_PER_REFRESH = 4;
const MATERIALS_CACHE_KEY = "koan-plus-cle-materials-v14";
const MATERIALS_CACHE_TTL_MS = 30 * 60 * 1000;
const MATERIALS_PAGE_SIZE = 100;
const MAX_MATERIAL_FOLDER_DEPTH = 8;
const CLE_LEASE_KEY = "koan-plus-cle-refresh-lease-v1";
const CLE_ATTEMPT_KEY = "koan-plus-cle-refresh-attempt-v1";
const CLE_FAILURE_KEY = "koan-plus-cle-refresh-failure-v1";
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
  dueAt: string;
  status: CleTaskStatus;
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
  coursesUpdatedAt: string | null;
  taskStatusesUpdatedAt: string | null;
  announcementsUpdatedAt?: string | null;
  announcementCourses?: Record<string, CleAnnouncementCourseCache>;
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
  coursesUpdatedAt: null,
  taskStatusesUpdatedAt: null,
  announcementsUpdatedAt: null,
  announcementCourses: {},
};

type CleTabResponse = {
  ok: boolean;
  status: number;
  text?: string;
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
type CleRefreshOptions = {
  activeCourseCodes?: string[];
  priorityCourseCode?: string;
  messagesFocused?: boolean;
  bypassBackoff?: boolean;
};

const jsonRequests = new Map<string, Promise<unknown>>();
const materialRequests = new Map<string, Promise<CleMaterialList>>();
const downloadRequests = new Map<string, Promise<number>>();

function readTimestamp(key: string) {
  const value = Number.parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(value) ? value : 0;
}

function timestampValue(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFresh(value: string | null | undefined, ttl: number) {
  const timestamp = timestampValue(value);
  return timestamp > 0 && Date.now() - timestamp < ttl;
}

function clePartUpdatedAt(previous: CleData | null | undefined, key: keyof Pick<
  CleData,
  "coursesUpdatedAt" | "tasksUpdatedAt" | "messagesUpdatedAt" | "taskStatusesUpdatedAt" | "announcementsUpdatedAt"
>) {
  return (previous?.[key] as string | null) || previous?.updatedAt || null;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const latest = Math.max(0, ...values.map(timestampValue));
  return latest ? new Date(latest).toISOString() : null;
}

export function isCleCacheFresh(data: CleData) {
  if (data.courses?.length && !data.courses.some((c) => "available" in c)) {
    return false;
  }
  return (
    isFresh(clePartUpdatedAt(data, "coursesUpdatedAt"), CLE_COURSES_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "tasksUpdatedAt"), CLE_TASKS_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "messagesUpdatedAt"), CLE_MESSAGES_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "taskStatusesUpdatedAt"), CLE_TASK_STATUSES_TTL_MS)
  );
}

type FailureState = {
  count: number;
  nextRetryAt: number;
};

function readFailureState(key: string): FailureState {
  try {
    const state = JSON.parse(localStorage.getItem(key) || "{}") as Partial<FailureState>;
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

function recordFailure(key: string) {
  const previous = readFailureState(key);
  const count = previous.count + 1;
  const delay = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(count - 1, 6)));
  localStorage.setItem(key, JSON.stringify({
    count,
    nextRetryAt: Date.now() + delay,
  }));
}

function acquireLease() {
  const now = Date.now();
  if (readTimestamp(CLE_LEASE_KEY) > now) {
    throw new Error("別の画面でCLEを更新中です。");
  }
  localStorage.setItem(CLE_LEASE_KEY, String(now + REQUEST_TIMEOUT_MS * 4));
  return () => localStorage.removeItem(CLE_LEASE_KEY);
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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function results(value: unknown) {
  const items = asRecord(value).results;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function pagingNextUrl(value: unknown) {
  const paging = asRecord(asRecord(value).paging);
  return asString(paging.nextPage);
}

function courseCodeFromDisplayId(value: string) {
  return value.match(/^\d{4}-\d{2}-(\d{6})-/)?.[1] || "";
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

function isYes(value: unknown) {
  return value === true || String(value).toLowerCase() === "yes" || String(value) === "1";
}

async function withTimeout<T>(task: Promise<T>, milliseconds: number) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("CLE APIの応答が30秒以内に返りませんでした。CLEタブを再読み込みして再試行してください。")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function fetchJson(url: string, tabId?: number) {
  requireCleApiUrl(url);
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("CLE取得はChrome拡張機能から実行してください。");
  }
  const key = `${tabId || "auto"}:${url}`;
  const existing = jsonRequests.get(key);
  if (existing) return existing;
  const request = (async () => {
    const result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-fetch",
        request: { url, options: { method: "GET" } },
        tabId,
      }) as Promise<CleTabMessage>,
      REQUEST_TIMEOUT_MS,
    );
    if (!result.ok || !result.response) {
      throw new Error(result.error || "CLEタブから応答を取得できませんでした。");
    }
    if (!result.response.ok) {
      throw new Error(`CLEの取得に失敗しました (${result.response.status})。`);
    }
    try {
      return JSON.parse(result.response.text || "") as unknown;
    } catch {
      throw new Error("CLEからJSON以外の応答が返りました。ログイン状態を確認してください。");
    }
  })();
  jsonRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (jsonRequests.get(key) === request) jsonRequests.delete(key);
  }
}

function loadMaterialCache(): Record<string, CleMaterialList> {
  try {
    const value = JSON.parse(localStorage.getItem(MATERIALS_CACHE_KEY) || "{}") as unknown;
    return asRecord(value) as Record<string, CleMaterialList>;
  } catch {
    return {};
  }
}

function saveMaterialCache(cache: Record<string, CleMaterialList>) {
  localStorage.setItem(MATERIALS_CACHE_KEY, JSON.stringify(cache));
}

function isMaterialCacheFresh(value: CleMaterialList | undefined) {
  return Boolean(value?.updatedAt && isFresh(value.updatedAt, MATERIALS_CACHE_TTL_MS));
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
  try {
    const result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-head-batch",
        urls,
        tabId,
      }) as Promise<CleTabMessage>,
      Math.max(REQUEST_TIMEOUT_MS, urls.length * 2000),
    );
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
  } catch {
    // Fall through to slower name resolution paths.
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
    return result?.ok && Array.isArray(result.files) ? result.files : [];
  } catch {
    return [];
  }
}

async function fetchDocumentFileNames(
  courseId: string,
  contentIds: string[],
  tabId?: number,
) {
  if (!contentIds.length) return [];
  try {
    const result = await withTimeout(
      chrome.runtime.sendMessage({
        type: "cle-document-files",
        courseId,
        contentIds,
        tabId,
      }) as Promise<CleTabMessage>,
      Math.max(REQUEST_TIMEOUT_MS, contentIds.length * 30 * 1000),
    );
    return result?.ok && Array.isArray(result.files) ? result.files : [];
  } catch {
    return [];
  }
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

async function fetchAllResults(url: string, tabId?: number) {
  const collected: JsonRecord[] = [];
  let nextUrl = url;
  for (let page = 0; page < 20 && nextUrl; page += 1) {
    const response = await fetchJson(nextUrl, tabId);
    const items = results(response);
    collected.push(...items);
    const next = pagingNextUrl(response);
    if (next) {
      nextUrl = next.startsWith("http") ? next : `${CLE_ORIGIN}${next}`;
    } else if (items.length >= MATERIALS_PAGE_SIZE) {
      const parsed = new URL(nextUrl);
      const offset = Number.parseInt(parsed.searchParams.get("offset") || "0", 10);
      parsed.searchParams.set("offset", String(offset + items.length));
      nextUrl = parsed.toString();
    } else {
      nextUrl = "";
    }
  }
  return collected;
}

async function fetchContentChildren(courseId: string, contentId: string, tabId?: number) {
  const suffix = `/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/children?limit=${MATERIALS_PAGE_SIZE}`;
  try {
    return await fetchAllResults(`${API_ORIGIN}/public/v1${suffix}`, tabId);
  } catch {
    return fetchAllResults(`${API_ORIGIN}/v1${suffix}`, tabId);
  }
}

async function fetchDocumentDetails(courseId: string, contentId: string, tabId?: number) {
  const suffix = `/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}`;
  // Ultra documents are not fully exposed by every REST version, so query both and keep what responds.
  const details = await Promise.all([
    fetchJson(`${API_ORIGIN}/public/v1${suffix}`, tabId).catch(() => null),
    fetchJson(`${API_ORIGIN}/v1${suffix}`, tabId).catch(() => null),
  ]);
  return details.filter((detail) => detail !== null);
}

async function fetchContentAttachments(
  courseId: string,
  content: JsonRecord,
  folderPath: string[],
  tabId?: number,
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
  } catch {
    try {
      attachmentsBase = `${API_ORIGIN}/v1`;
      attachments = await fetchAllResults(`${attachmentsBase}${attachmentsSuffix}?limit=${MATERIALS_PAGE_SIZE}`, tabId);
    } catch {
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
    );
  } catch {
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
): Promise<CleMaterial[]> {
  if (depth > MAX_MATERIAL_FOLDER_DEPTH) return [];
  const contents = parentContentId
    ? await fetchContentChildren(courseId, parentContentId, tabId)
    : await fetchAllResults(
      `${API_ORIGIN}/public/v1/courses/${encodeURIComponent(courseId)}/contents?limit=${MATERIALS_PAGE_SIZE}`,
      tabId,
    );
  if (documents && parentContentId) {
    for (const content of contents) {
      const contentId = asString(content.id);
      if (!contentId || !isDocumentContent(content)) continue;
      documents.set(contentId, { contentId, parentId: parentContentId });
    }
  }
  const directMaterials = await Promise.all(
    contents.map((content) => fetchContentAttachments(courseId, content, folderPath, tabId)),
  );
  const childMaterials = await Promise.all(
    contents
      .filter(contentHasChildren)
      .map((content) => fetchMaterialChildren(courseId, content, folderPath, depth, tabId, documents)),
  );
  return [...directMaterials, ...childMaterials].flat();
}

export async function fetchCourseMaterials(
  courseId: string,
  tabId?: number,
  force = false,
): Promise<CleMaterialList> {
  const cache = loadMaterialCache();
  if (!force && isMaterialCacheFresh(cache[courseId])) return cache[courseId];
  const existing = materialRequests.get(courseId);
  if (existing) return existing;
  const documents = new Map<string, CleDocumentStub>();
  const request = fetchMaterialFolder(courseId, null, [], 0, tabId, documents)
    .then(async (materials) => {
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
      };
      saveMaterialCache({ ...cache, [courseId]: result });
      return result;
    });
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

function taskStatus(attemptsResponse: unknown, gradeResponse: unknown, dueAt: string) {
  const attempts = results(attemptsResponse);
  const latestAttempt = attempts[0] || {};
  const attemptStatus = asString(latestAttempt.status);
  const gradeStatus = asString(asRecord(gradeResponse).status);
  if (/graded|completed|posted/i.test(gradeStatus)) return "採点済み";
  if (/inprogress/i.test(attemptStatus)) return "一時保存";
  if (attempts.length || /needsgrading|submitted/i.test(gradeStatus)) return "提出済み";
  if (new Date(dueAt).getTime() < Date.now()) return "期限切れ";
  return "未着手";
}

async function fetchTaskStatus(task: CleTask, tabId?: number): Promise<CleTask> {
  try {
    const path = `${API_ORIGIN}/public/v2/courses/${encodeURIComponent(task.courseId)}/gradebook/columns/${encodeURIComponent(task.id)}`;
    const [grade, attempts] = await Promise.all([
      fetchJson(`${path}/users/me`, tabId),
      fetchJson(`${path}/attempts?limit=10`, tabId),
    ]);
    return {
      ...task,
      status: taskStatus(attempts, grade, task.dueAt),
      statusUpdatedAt: new Date().toISOString(),
    };
  } catch {
    return task;
  }
}

async function fetchTasks(tabId?: number) {
  const since = new Date(Date.now() - TASK_STATUS_WINDOW_MS).toISOString();
  const until = new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    since,
    until,
    fields: "id,type,calendarId,calendarName,title,start,end,dynamicCalendarItemProps",
  });
  const response = await fetchJson(`${API_ORIGIN}/public/v1/calendars/items?${params}`, tabId);
  const tasks = results(response)
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
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  return tasks;
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
        statusUpdatedAt: previous.statusUpdatedAt,
      }
      : task;
  });
}

function taskStatusTtl(task: CleTask) {
  if (task.status === "採点済み") return Number.POSITIVE_INFINITY;
  if (task.status === "提出済み") return 6 * 60 * 60 * 1000;
  if (task.status === "期限切れ") return 24 * 60 * 60 * 1000;
  return CLE_TASK_STATUSES_TTL_MS;
}

function taskStatusPriority(task: CleTask) {
  const dueAt = new Date(task.dueAt).getTime();
  const distance = dueAt - Date.now();
  const unresolved = !["提出済み", "採点済み", "期限切れ"].includes(task.status);
  if (unresolved && distance >= 0 && distance <= 24 * 60 * 60 * 1000) {
    return distance;
  }
  if (unresolved && distance >= 0) return 24 * 60 * 60 * 1000 + distance;
  if (task.status === "提出済み") return 2 * TASK_STATUS_WINDOW_MS + Math.abs(distance);
  return 3 * TASK_STATUS_WINDOW_MS + Math.abs(distance);
}

async function refreshTaskStatuses(tasks: CleTask[], tabId?: number, force = false) {
  const statusTargets = tasks
    .filter((task) => new Date(task.dueAt).getTime() <= Date.now() + TASK_STATUS_WINDOW_MS)
    .filter((task) => task.status !== "採点済み")
    .filter((task) =>
      force || !isFresh(task.statusUpdatedAt, taskStatusTtl(task)),
    )
    .sort((left, right) => taskStatusPriority(left) - taskStatusPriority(right))
    .slice(0, MAX_STATUS_REQUESTS);
  const statuses = new Map<string, CleTask>();
  for (const task of statusTargets) {
    const status = await fetchTaskStatus(task, tabId);
    statuses.set(cachedTaskKey(status), status);
  }
  return tasks.map((task) => statuses.get(cachedTaskKey(task)) || task);
}

async function fetchMessages(tabId?: number) {
  const messages = new Map<string, CleMessageCourse>();
  let offset = 0;
  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const response = await fetchJson(
      `${API_ORIGIN}/v1/messages/summary?offset=${offset}&limit=${MESSAGE_PAGE_SIZE}`,
      tabId,
    );
    const items = results(response);
    for (const item of items) {
      const courseId = asString(item.courseId);
      const unreadCount = asNumber(item.numUnreadMessages);
      if (!courseId || unreadCount <= 0) continue;
      messages.set(courseId, {
        courseId,
        courseName: asString(item.courseName) || "CLE科目",
        unreadCount,
      });
    }
    const paging = asRecord(asRecord(response).paging);
    if ("nextPage" in paging ? !asString(paging.nextPage) : items.length < MESSAGE_PAGE_SIZE) break;
    if (!items.length) break;
    offset += items.length;
  }
  return [...messages.values()].sort(
    (left, right) => right.unreadCount - left.unreadCount,
  );
}

async function fetchCourses(tabId?: number) {
  const response = await fetchJson(
    `${API_ORIGIN}/public/v1/users/me/courses?limit=100&expand=course`,
    tabId,
  );
  return results(response)
    .map((item): CleCourse => {
      const course = asRecord(item.course);
      const courseId = asString(item.courseId) || asString(course.id);
      const displayId =
        asString(course.courseId) ||
        asString(course.externalId) ||
        asString(item.courseId);
      const itemAvailability = asRecord(item.availability).available;
      const courseAvailability = course.availability ? asRecord(course.availability).available : undefined;
      const isAvailable = isYes(itemAvailability) && (courseAvailability === undefined || isYes(courseAvailability));
      return {
        courseId,
        displayId,
        timetableCode: courseCodeFromDisplayId(displayId),
        name: asString(course.name) || asString(item.name) || displayId,
        available: isAvailable,
      };
    })
    .filter((course) => course.courseId && course.timetableCode)
    .sort((left, right) => left.displayId.localeCompare(right.displayId));
}

async function fetchAnnouncements(course: CleCourse, tabId?: number): Promise<CleAnnouncement[]> {
  const response = await fetchJson(
    `${API_ORIGIN}/public/v1/courses/${encodeURIComponent(course.courseId)}/announcements`,
    tabId,
  );
  return results(response).map((item): CleAnnouncement => ({
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
        const announcements = await fetchAnnouncements(course, tabId);
        cache[course.courseId] = {
          announcements,
          updatedAt: new Date().toISOString(),
          failureCount: 0,
          nextRetryAt: 0,
        };
      } catch {
        const old = cache[course.courseId];
        const failureCount = (old?.failureCount || 0) + 1;
        const delay = Math.min(
          60 * 60 * 1000,
          60 * 1000 * (2 ** Math.min(failureCount - 1, 6)),
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

  const workers = Array.from({ length: Math.min(limit, candidates.length) }, worker);
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
  return { announcements, cache, updatedAt };
}

export async function refreshCle(
  previous?: CleData | null,
  tabId?: number,
  onProgress?: (value: string) => void,
  force = false,
  options: CleRefreshOptions = {},
): Promise<CleData> {
  if (!options.bypassBackoff) requireRetryAvailable(CLE_FAILURE_KEY, "CLE更新");
  if (!force) {
    requireCooldown(CLE_ATTEMPT_KEY, 60 * 1000, "CLE更新の再試行は1分後にできます。");
  }
  const release = acquireLease();
  localStorage.setItem(CLE_ATTEMPT_KEY, String(Date.now()));
  try {
    onProgress?.("CLEキャッシュを確認中");
    const completed = new Set<string>();
    const markDone = (label: string) => {
      completed.add(label);
      onProgress?.(`${[...completed].join(" / ")} 取得済み`);
    };
    const now = new Date().toISOString();
    const coursesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "coursesUpdatedAt"), CLE_COURSES_TTL_MS);
    const tasksFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "tasksUpdatedAt"), CLE_TASKS_TTL_MS);
    const messagesTtl = options.messagesFocused
      ? CLE_MESSAGES_FOCUSED_TTL_MS
      : CLE_MESSAGES_TTL_MS;
    const messagesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "messagesUpdatedAt"), messagesTtl);
    const taskStatusesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "taskStatusesUpdatedAt"), CLE_TASK_STATUSES_TTL_MS);
    const [taskList, messages, coursesResult] = await Promise.all([
      tasksFresh
        ? Promise.resolve(previous?.tasks || []).then((result) => {
          markDone("課題キャッシュ");
          return result;
        })
        : fetchTasks(tabId).then((result) => {
          markDone("課題");
          return result;
        }),
      messagesFresh
        ? Promise.resolve(previous?.messages || []).then((result) => {
          markDone("メッセージキャッシュ");
          return result;
        })
        : fetchMessages(tabId).then((result) => {
          markDone("メッセージ");
          return result;
        }),
      coursesFresh
        ? Promise.resolve({
          courses: previous?.courses || [],
          updatedAt: clePartUpdatedAt(previous, "coursesUpdatedAt"),
        }).then((result) => {
          markDone("コースキャッシュ");
          return result;
        })
        : fetchCourses(tabId)
          .then((courses) => {
            markDone("コース");
            return { courses, updatedAt: now };
          })
          .catch(() => {
            markDone("コースキャッシュ");
            return {
              courses: previous?.courses || [],
              updatedAt: clePartUpdatedAt(previous, "coursesUpdatedAt"),
            };
          }),
    ]);
    let tasks = tasksFresh ? taskList : mergeCachedTaskStatuses(taskList, previous?.tasks || []);
    let taskStatusesUpdatedAt = taskStatusesFresh
      ? clePartUpdatedAt(previous, "taskStatusesUpdatedAt")
      : null;
    if (taskStatusesFresh) {
      markDone("状態キャッシュ");
    } else {
      tasks = await refreshTaskStatuses(tasks, tabId, force);
      taskStatusesUpdatedAt = now;
      markDone("状態");
    }

    const courses = coursesResult.courses;
    const coursesUpdatedAt = coursesResult.updatedAt;

    const recentCourseIds = new Set([
      ...tasks.map((task) => task.courseId),
      ...messages.map((message) => message.courseId),
    ]);
    const activeCodes = new Set(options.activeCourseCodes || []);
    const resolvedActiveIds = new Set<string>();
    if (activeCodes.size) {
      for (const code of activeCodes) {
        const match = courses.find((c) => c.timetableCode === code);
        if (match) {
          if (match.available !== false) {
            resolvedActiveIds.add(match.courseId);
          } else {
            const parentMatch = courses.find(
              (c) => c.available !== false && courseNamesMatch(match.name, c.name)
            );
            if (parentMatch) {
              resolvedActiveIds.add(parentMatch.courseId);
            } else {
              resolvedActiveIds.add(match.courseId);
            }
          }
        }
      }
    }
    const announcementCourses = courses.filter((course) =>
      activeCodes.size
        ? resolvedActiveIds.has(course.courseId)
        : recentCourseIds.has(course.courseId),
    );
    onProgress?.("連絡事項を取得中");
    const announcementResult = await refreshAnnouncements(
      announcementCourses,
      previous?.announcementCourses || {},
      recentCourseIds,
      options.priorityCourseCode || "",
      tabId,
    );
    const announcements = announcementResult.announcements;
    const announcementsUpdatedAt = announcementResult.updatedAt;
    markDone("連絡事項");

    onProgress?.("取得結果を整理中");
    const tasksUpdatedAt = tasksFresh ? clePartUpdatedAt(previous, "tasksUpdatedAt") : now;
    const messagesUpdatedAt = messagesFresh ? clePartUpdatedAt(previous, "messagesUpdatedAt") : now;
    localStorage.removeItem(CLE_FAILURE_KEY);
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
      taskStatusesUpdatedAt,
      announcementsUpdatedAt,
      announcementCourses: announcementResult.cache,
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

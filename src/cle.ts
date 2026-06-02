const CLE_ORIGIN = "https://www.cle.osaka-u.ac.jp";
const API_ORIGIN = `${CLE_ORIGIN}/learn/api`;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_MESSAGE_PAGES = 8;
const TASK_STATUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STATUS_REQUESTS = 12;
const CLE_LEASE_KEY = "koan-plus-cle-refresh-lease-v1";

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
};

export type CleMessageCourse = {
  courseId: string;
  courseName: string;
  unreadCount: number;
};

export type CleData = {
  tasks: CleTask[];
  messages: CleMessageCourse[];
  unreadMessages: number;
  updatedAt: string | null;
};

export const EMPTY_CLE_DATA: CleData = {
  tasks: [],
  messages: [],
  unreadMessages: 0,
  updatedAt: null,
};

type CleTabResponse = {
  ok: boolean;
  status: number;
  text: string;
};

type CleTabMessage = {
  ok: boolean;
  response?: CleTabResponse;
  error?: string;
};

type JsonRecord = Record<string, unknown>;

function readTimestamp(key: string) {
  const value = Number.parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(value) ? value : 0;
}

function acquireLease() {
  const now = Date.now();
  if (readTimestamp(CLE_LEASE_KEY) > now) {
    throw new Error("別の画面でCLEを更新中です。");
  }
  localStorage.setItem(CLE_LEASE_KEY, String(now + REQUEST_TIMEOUT_MS * 4));
  return () => localStorage.removeItem(CLE_LEASE_KEY);
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

function results(value: unknown) {
  const items = asRecord(value).results;
  return Array.isArray(items) ? items.map(asRecord) : [];
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
    return JSON.parse(result.response.text) as unknown;
  } catch {
    throw new Error("CLEからJSON以外の応答が返りました。ログイン状態を確認してください。");
  }
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
    return { ...task, status: taskStatus(attempts, grade, task.dueAt) };
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
  const statusTargets = tasks
    .filter((task) => new Date(task.dueAt).getTime() <= Date.now() + TASK_STATUS_WINDOW_MS)
    .slice(0, MAX_STATUS_REQUESTS);
  const statuses = new Map<string, CleTask>();
  for (const task of statusTargets) {
    const status = await fetchTaskStatus(task, tabId);
    statuses.set(status.id, status);
  }
  return tasks.map((task) => statuses.get(task.id) || task);
}

async function fetchMessages(tabId?: number) {
  const messages = new Map<string, CleMessageCourse>();
  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const response = await fetchJson(
      `${API_ORIGIN}/v1/messages/summary?offset=${page * 25}&limit=25`,
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
    if ("nextPage" in paging ? !asString(paging.nextPage) : items.length < 25) break;
  }
  return [...messages.values()].sort(
    (left, right) => right.unreadCount - left.unreadCount,
  );
}

export async function refreshCle(tabId?: number): Promise<CleData> {
  const release = acquireLease();
  try {
    const [tasks, messages] = await Promise.all([fetchTasks(tabId), fetchMessages(tabId)]);
    return {
      tasks,
      messages,
      unreadMessages: messages.reduce((sum, item) => sum + item.unreadCount, 0),
      updatedAt: new Date().toISOString(),
    };
  } finally {
    release();
  }
}

export function cleTaskUrl(task: CleTask) {
  return `${CLE_ORIGIN}/ultra/courses/${encodeURIComponent(task.courseId)}/grades`;
}

export function cleMessageUrl(courseId: string) {
  return `${CLE_ORIGIN}/ultra/courses/${encodeURIComponent(courseId)}/messages`;
}

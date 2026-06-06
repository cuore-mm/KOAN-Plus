const CLE_ORIGIN = "https://www.cle.osaka-u.ac.jp";
const API_ORIGIN = `${CLE_ORIGIN}/learn/api`;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_MESSAGE_PAGES = 8;
const MESSAGE_PAGE_SIZE = 100;
const TASK_STATUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STATUS_REQUESTS = 12;
const CLE_LEASE_KEY = "koan-plus-cle-refresh-lease-v1";
const CLE_ATTEMPT_KEY = "koan-plus-cle-refresh-attempt-v1";
export const CLE_TASKS_TTL_MS = 10 * 60 * 1000;
export const CLE_MESSAGES_TTL_MS = 5 * 60 * 1000;
export const CLE_COURSES_TTL_MS = 24 * 60 * 60 * 1000;
export const CLE_TASK_STATUSES_TTL_MS = 30 * 60 * 1000;

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
};

export type CleData = {
  courses: CleCourse[];
  tasks: CleTask[];
  messages: CleMessageCourse[];
  unreadMessages: number;
  updatedAt: string | null;
  tasksUpdatedAt: string | null;
  messagesUpdatedAt: string | null;
  coursesUpdatedAt: string | null;
  taskStatusesUpdatedAt: string | null;
};

export const EMPTY_CLE_DATA: CleData = {
  courses: [],
  tasks: [],
  messages: [],
  unreadMessages: 0,
  updatedAt: null,
  tasksUpdatedAt: null,
  messagesUpdatedAt: null,
  coursesUpdatedAt: null,
  taskStatusesUpdatedAt: null,
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
  "coursesUpdatedAt" | "tasksUpdatedAt" | "messagesUpdatedAt" | "taskStatusesUpdatedAt"
>) {
  return previous?.[key] || previous?.updatedAt || null;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const latest = Math.max(0, ...values.map(timestampValue));
  return latest ? new Date(latest).toISOString() : null;
}

export function isCleCacheFresh(data: CleData) {
  return (
    isFresh(clePartUpdatedAt(data, "coursesUpdatedAt"), CLE_COURSES_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "tasksUpdatedAt"), CLE_TASKS_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "messagesUpdatedAt"), CLE_MESSAGES_TTL_MS) &&
    isFresh(clePartUpdatedAt(data, "taskStatusesUpdatedAt"), CLE_TASK_STATUSES_TTL_MS)
  );
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

function results(value: unknown) {
  const items = asRecord(value).results;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function courseCodeFromDisplayId(value: string) {
  return value.match(/^\d{4}-\d{2}-(\d{6})-/)?.[1] || "";
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
  if (distance >= 0) return distance;
  return TASK_STATUS_WINDOW_MS + Math.abs(distance);
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
      return {
        courseId,
        displayId,
        timetableCode: courseCodeFromDisplayId(displayId),
        name: asString(course.name) || asString(item.name) || displayId,
      };
    })
    .filter((course) => course.courseId && course.timetableCode)
    .sort((left, right) => left.displayId.localeCompare(right.displayId));
}

export async function refreshCle(
  previous?: CleData | null,
  tabId?: number,
  onProgress?: (value: string) => void,
  force = false,
): Promise<CleData> {
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
    const messagesFresh = !force &&
      isFresh(clePartUpdatedAt(previous, "messagesUpdatedAt"), CLE_MESSAGES_TTL_MS);
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
    onProgress?.("取得結果を整理中");
    const courses = coursesResult.courses;
    const coursesUpdatedAt = coursesResult.updatedAt;
    const tasksUpdatedAt = tasksFresh ? clePartUpdatedAt(previous, "tasksUpdatedAt") : now;
    const messagesUpdatedAt = messagesFresh ? clePartUpdatedAt(previous, "messagesUpdatedAt") : now;
    return {
      courses,
      tasks,
      messages,
      unreadMessages: messages.reduce((sum, item) => sum + item.unreadCount, 0),
      updatedAt: latestTimestamp([coursesUpdatedAt, tasksUpdatedAt, messagesUpdatedAt, taskStatusesUpdatedAt]),
      coursesUpdatedAt,
      tasksUpdatedAt,
      messagesUpdatedAt,
      taskStatusesUpdatedAt,
    };
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

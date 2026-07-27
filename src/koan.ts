const BASE_URL = "https://koan.osaka-u.ac.jp/campusweb/";
export const PORTAL_URL = `${BASE_URL}campusportal.do?page=main`;
export const SCHEDULE_URL = `${BASE_URL}campussquare.do?_flowId=PTW0001200-flow`;
export const COURSE_REGISTRATION_URL = `${BASE_URL}campussquare.do?_flowId=RSW0001000-flow`;
export const CHANGES_URL = `${BASE_URL}campussquare.do?_flowId=KHW0001100-flow`;
export const BOARD_URL = `${BASE_URL}campussquare.do?_flowId=KJW0001100-flow`;
export const GRADE_HISTORY_URL = `${BASE_URL}campussquare.do?_flowId=SIW0001200-flow`;
export const CREDIT_STATUS_URL = `${BASE_URL}campussquare.do?_flowId=SIW0001300-flow`;

export const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
export const NOTICE_SNAPSHOT_VERSION = 2;
export const LIGHT_REFRESH_TTL_MS = 10 * 60 * 1000;
export const SCHEDULE_REFRESH_TTL_MS = 30 * 60 * 1000;
export const FUTURE_SCHEDULE_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
export const COURSES_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const BOARD_REQUEST_GAP_MS = 750;
const MAX_BOARD_PAGES_PER_GENRE = 12;
const SCHEDULE_RANGE_WEEKS = 8;
const MAX_SCHEDULE_MONTH_PAGES = 4;
const SNAPSHOT_MAX_DURATION_MS = 3 * 60 * 1000;
const NOTICE_RESOLVE_MAX_DURATION_MS = 60 * 1000;
const LIGHT_LEASE_KEY = "koan-plus-light-refresh-lease-v1";
const LIGHT_ATTEMPT_KEY = "koan-plus-light-refresh-attempt-v1";
const LIGHT_FAILURE_KEY = "koan-plus-light-refresh-failure-v1";
const SNAPSHOT_LEASE_KEY = "koan-plus-snapshot-lease-v1";
const SNAPSHOT_ATTEMPT_KEY = "koan-plus-snapshot-attempt-v1";
const SNAPSHOT_COMPLETED_KEY = "koan-plus-snapshot-completed-v2";
const SNAPSHOT_FAILURE_KEY = "koan-plus-snapshot-failure-v1";
const NOTICE_RESOLVE_LEASE_KEY = "koan-plus-notice-resolve-lease-v1";
const NOTICE_RESOLVE_ATTEMPT_KEY = "koan-plus-notice-resolve-attempt-v1";
const NOTICE_RESOLVE_FAILURE_KEY = "koan-plus-notice-resolve-failure-v1";
const NOTICE_URL_CACHE_KEY = "koan-plus-notice-url-cache-v1";
const GRADES_LEASE_KEY = "koan-plus-grades-lease-v1";
const GRADES_ATTEMPT_KEY = "koan-plus-grades-attempt-v1";
const NOTICE_URL_TTL_MS = 6 * 60 * 60 * 1000;
const NOTICE_URL_FAILURE_TTL_MS = 10 * 60 * 1000;

export const GENRES = [
  "授業",
  "個別連絡",
  "教務",
  "副専攻・副ﾌﾟﾛｸﾞﾗﾑ",
  "教職",
  "奨学支援",
  "ｷｬﾘｱ支援",
  "学生生活",
  "留学生向け",
  "海外留学",
  "その他",
];



export type ScheduleItem = { date?: string; period: string; title: string; room: string };
export type CourseRegistration = {
  code: string;
  departmentCode: string;
  year: string;
  title: string;
  day: string;
  period: string;
  teacherAndRoom: string;
  syllabusUrl: string;
  isIntensive?: boolean;
};
export type ChangeItem = { type: string; date: string; period: string; course: string };
export type Notice = {
  title: string;
  href: string;
  genre: string;
  priority: string;
  unread: boolean;
  department: string;
  author: string;
  period: string;
  live: boolean;
  isNew?: boolean;
};
export type KoanData = {
  schedule: ScheduleItem[];
  courses: CourseRegistration[];
  changes: ChangeItem[];
  notices: Notice[];
  lightUpdatedAt: string | null;
  snapshotUpdatedAt: string | null;
  scheduleUpdatedAt: string | null;
  futureScheduleUpdatedAt: string | null;
  coursesUpdatedAt: string | null;
  changesUpdatedAt: string | null;
  noticesUpdatedAt: string | null;
  snapshotVersion?: number;
  snapshotGenreSyncAt?: Record<string, string>;
};
export type GradeHistoryItem = {
  code: string;
  course: string;
  teacher: string;
  year: string;
  grade: string;
  pass: string;
};
export type CreditCourse = {
  majorCategory: string;
  minorCategory: string;
  course: string;
  credits: number;
  year: string;
  term: string;
  grade: string;
  pass: string;
};
export type CreditGroup = {
  name: string;
  credits: number;
  courses: CreditCourse[];
};
export type TermGpa = {
  year: string;
  term: string;
  gpa: string;
};
export type GradeData = {
  creditsTotal: number | null;
  cumulativeGpa: string;
  termGpas: TermGpa[];
  groups: CreditGroup[];
  courses: CreditCourse[];
  history: GradeHistoryItem[];
  updatedAt: string;
};

const normalize = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const htmlRequests = new Map<string, Promise<{ doc: Document; url: string }>>();
const noticeResolveRequests = new Map<string, Promise<string | null>>();


function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function requireKoanUrl(url: string) {
  if (new URL(url).origin !== "https://koan.osaka-u.ac.jp") {
    throw new Error("KOAN以外への通信は許可されていません。");
  }
}

async function fetchHtml(url: string, options?: RequestInit) {
  requireKoanUrl(url);
  const method = options?.method || "GET";
  const key = method === "GET" ? url : "";
  const existing = key ? htmlRequests.get(key) : undefined;
  if (existing) return existing;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: "include",
        redirect: "follow",
        ...options,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`KOANの取得に失敗しました (${response.status})。`);
      }
      return {
        doc: new DOMParser().parseFromString(await response.text(), "text/html"),
        url: response.url,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("KOANの応答が15秒以内に返りませんでした。");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  if (key) htmlRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (key && htmlRequests.get(key) === request) htmlRequests.delete(key);
  }
}

function readTimestamp(key: string) {
  const value = Number.parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(value) ? value : 0;
}

type FailureState = {
  count: number;
  nextRetryAt: number;
};

export type SnapshotAvailability = {
  blockedUntil: number;
  reason: "completed" | "retry" | "backoff" | "syncing" | "resolving" | null;
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

export function getSnapshotAvailability(): SnapshotAvailability {
  const now = Date.now();
  const snapshotLeaseUntil = readTimestamp(SNAPSHOT_LEASE_KEY);
  if (snapshotLeaseUntil > now) {
    return { blockedUntil: snapshotLeaseUntil, reason: "syncing" };
  }
  const noticeResolveLeaseUntil = readTimestamp(NOTICE_RESOLVE_LEASE_KEY);
  if (noticeResolveLeaseUntil > now) {
    return { blockedUntil: noticeResolveLeaseUntil, reason: "resolving" };
  }
  const candidates: Array<{
    blockedUntil: number;
    reason: SnapshotAvailability["reason"];
  }> = [
    {
      blockedUntil: readTimestamp(SNAPSHOT_COMPLETED_KEY) + SNAPSHOT_TTL_MS,
      reason: "completed",
    },
    {
      blockedUntil: readTimestamp(SNAPSHOT_ATTEMPT_KEY) + 10 * 60 * 1000,
      reason: "retry",
    },
    {
      blockedUntil: readFailureState(SNAPSHOT_FAILURE_KEY).nextRetryAt,
      reason: "backoff",
    },
  ];
  return candidates
    .filter((candidate) => candidate.blockedUntil > now)
    .sort((left, right) => right.blockedUntil - left.blockedUntil)[0] || {
      blockedUntil: 0,
      reason: null,
    };
}

function timestampValue(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFresh(value: string | null | undefined, ttl: number) {
  const timestamp = timestampValue(value);
  return timestamp > 0 && Date.now() - timestamp < ttl;
}

function koanPartUpdatedAt(
  data: KoanData | null | undefined,
  key: keyof Pick<
    KoanData,
    | "scheduleUpdatedAt"
    | "futureScheduleUpdatedAt"
    | "coursesUpdatedAt"
    | "changesUpdatedAt"
    | "noticesUpdatedAt"
  >,
) {
  return data?.[key] || data?.lightUpdatedAt || null;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const latest = Math.max(0, ...values.map(timestampValue));
  return latest ? new Date(latest).toISOString() : null;
}

export function isKoanCacheFresh(data: KoanData) {
  return (
    isFresh(koanPartUpdatedAt(data, "changesUpdatedAt"), LIGHT_REFRESH_TTL_MS) &&
    isFresh(koanPartUpdatedAt(data, "noticesUpdatedAt"), LIGHT_REFRESH_TTL_MS) &&
    isFresh(koanPartUpdatedAt(data, "scheduleUpdatedAt"), SCHEDULE_REFRESH_TTL_MS) &&
    isFresh(koanPartUpdatedAt(data, "futureScheduleUpdatedAt"), FUTURE_SCHEDULE_REFRESH_TTL_MS) &&
    isFresh(koanPartUpdatedAt(data, "coursesUpdatedAt"), COURSES_REFRESH_TTL_MS)
  );
}

function acquireLease(key: string, milliseconds: number, message: string) {
  const now = Date.now();
  if (readTimestamp(key) > now) throw new Error(message);
  localStorage.setItem(key, String(now + milliseconds));
  return () => localStorage.removeItem(key);
}

function requireCooldown(key: string, milliseconds: number, message: string) {
  if (Date.now() - readTimestamp(key) < milliseconds) throw new Error(message);
}

function requireNoActiveLease(key: string, message: string) {
  if (readTimestamp(key) > Date.now()) throw new Error(message);
}

function requireTimeBudget(deadline: number, message: string) {
  if (Date.now() >= deadline) throw new Error(message);
}

type KoanTabResponse = {
  ok: boolean;
  status: number;
  text: string;
  url: string;
};

type KoanTabMessage = {
  ok: boolean;
  response?: KoanTabResponse;
  error?: string;
  tabId?: number;
};

async function withTimeout<T>(task: Promise<T>, milliseconds: number, message: string) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function fetchHtmlFromKoanTab(
  url: string,
  options?: RequestInit,
  tabId?: number,
) {
  requireKoanUrl(url);
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("成績取得はChrome拡張機能から実行してください。");
  }
  const result = await withTimeout(
    chrome.runtime.sendMessage({
      type: "koan-fetch",
      request: { url, options },
      tabId,
    }) as Promise<KoanTabMessage>,
    25000,
    "成績取得が25秒以内に完了しませんでした。KOANタブを再読み込みして再試行してください。",
  );
  if (!result.ok || !result.response) {
    throw new Error(result.error || "KOANタブから応答を取得できませんでした。");
  }
  if (!result.response.ok) {
    throw new Error(`KOANの取得に失敗しました (${result.response.status})。`);
  }
  return {
    doc: new DOMParser().parseFromString(result.response.text, "text/html"),
    url: result.response.url,
    tabId: result.tabId,
  };
}

function findTable(doc: Document, headers: string[]) {
  return [...doc.querySelectorAll("table")]
    .filter((table) => {
      const text = [...table.querySelectorAll("th")].map((cell) =>
        normalize(cell.textContent),
      );
      return headers.every((header) => text.includes(header));
    })
    .sort(
      (left, right) =>
        left.querySelectorAll("th").length - right.querySelectorAll("th").length,
    )[0];
}

function directRows(table: Element | undefined) {
  if (!table) return [];
  return [...table.querySelectorAll(":scope > tbody > tr")];
}

function cells(row: Element) {
  return [...row.querySelectorAll(":scope > td")].map((cell) =>
    normalize(cell.textContent),
  );
}

function parseNumber(value: string) {
  const number = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function requireLogin(doc: Document) {
  if (!doc.getElementById("portal-body")) {
    throw new Error("KOANにログインしてから更新してください。");
  }
}

function parseSchedule(doc: Document): ScheduleItem[] {
  const list = doc.querySelector(".mysch-portlet-list");
  if (!list) return [];
  return [...list.querySelectorAll("li")]
    .map((item) => normalize(item.textContent))
    .filter(Boolean)
    .map((text) => {
      const match = text.match(/^(\d+)限:\s*(.+?)(?:\s*@\s*(.+))?$/);
      return match
        ? { period: `${match[1]}限`, title: match[2], room: match[3] || "" }
        : { period: "", title: text, room: "" };
    });
}

function calendarDate(cell: Element) {
  const onclick = cell.querySelector(".cal-head-img a")?.getAttribute("onclick") || "";
  const match = onclick.match(/addSchedule\((\d{4})(\d{2})(\d{2})\)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function parseWeeklySchedule(doc: Document): ScheduleItem[] {
  const calendar = doc.getElementById("schedule-calender");
  if (!calendar) return [];
  return [...calendar.querySelectorAll(":scope > tbody > tr > td")]
    .flatMap((cell) => {
      const date = calendarDate(cell);
      if (!date) return [];
      return [...cell.querySelectorAll(".cal-content .kaiko")]
        .map((item) => normalize(item.textContent))
        .filter(Boolean)
        .map((text) => {
          const match = text.match(/^(\d+)限:\s*(.+?)(?:\s*@\s*(.+))?$/);
          return match
            ? { date, period: `${match[1]}限`, title: match[2], room: match[3] || "" }
            : { date, period: "", title: text, room: "" };
        });
    });
}

function maxCalendarDate(doc: Document) {
  const dates = [...doc.querySelectorAll("#schedule-calender > tbody > tr > td")]
    .map(calendarDate)
    .filter(Boolean)
    .map((date) => parseDateKey(date).getTime());
  return dates.length ? Math.max(...dates) : 0;
}

async function submitScheduleEvent(doc: Document, eventId: string) {
  const form = doc.querySelector<HTMLFormElement>("#ScheduleListForm");
  const executionKey = form
    ?.querySelector<HTMLInputElement>('input[name="_flowExecutionKey"]')
    ?.value;
  if (!form || !executionKey) {
    throw new Error("スケジュール管理画面を開始できませんでした。");
  }
  const params = new URLSearchParams({
    _flowExecutionKey: executionKey,
    _eventId: eventId,
  });
  return fetchHtml(new URL(form.getAttribute("action") || "campussquare.do", SCHEDULE_URL).href, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  });
}

async function fetchScheduleRange(includeFuture: boolean) {
  const pages: Document[] = [];
  let page = await fetchHtml(SCHEDULE_URL);
  const horizon = addDays(new Date(), SCHEDULE_RANGE_WEEKS * 7).getTime();
  for (let index = 0; index < MAX_SCHEDULE_MONTH_PAGES; index += 1) {
    pages.push(page.doc);
    if (!includeFuture || maxCalendarDate(page.doc) >= horizon) break;
    page = await submitScheduleEvent(page.doc, "setNextMonth");
  }
  return pages;
}

function calendarRange(doc: Document) {
  const dates = [...doc.querySelectorAll("#schedule-calender > tbody > tr > td")]
    .map(calendarDate)
    .filter(Boolean)
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

function mergeCurrentSchedule(
  currentPages: Document[],
  previousSchedule: ScheduleItem[],
  includeFuture: boolean,
) {
  const fetched = mergeSchedule(currentPages.flatMap(parseWeeklySchedule));
  if (includeFuture || !currentPages.length) return fetched;
  const range = calendarRange(currentPages[0]);
  if (!range) return fetched.length ? fetched : previousSchedule;
  return mergeSchedule([
    ...fetched,
    ...previousSchedule.filter((item) =>
      !item.date || item.date < range.start || item.date > range.end),
  ]).filter((item) =>
    !item.date || new Date(item.date).getTime() <= addDays(new Date(), SCHEDULE_RANGE_WEEKS * 7).getTime(),
  );
}

function mergeSchedule(items: ScheduleItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.date, item.period, item.title, item.room].join("\t");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSyllabusCall(value: string) {
  const match = value.match(/syllabusRefer\('([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\)/);
  return match
    ? { year: match[1], departmentCode: match[2], code: match[3] }
    : null;
}

function parseCourseRegistrations(doc: Document): CourseRegistration[] {
  const table = doc.querySelector("table.rishu-koma");
  const weekdays = ["月", "火", "水", "木", "金", "土"];
  const courses: CourseRegistration[] = [];
  if (table) {
    for (const row of [...table.querySelectorAll(":scope > tbody > tr")].slice(1)) {
      const rowCells = [...row.children].filter((cell) => cell.tagName === "TD");
      const period = normalize(rowCells[0]?.textContent);
      rowCells.slice(1).forEach((cell, index) => {
        const rows = [...cell.querySelectorAll(":scope table tr")]
          .map((innerRow) => normalize(innerRow.textContent))
          .filter(Boolean);
        if (!rows.length || rows[0] === "未登録") return;
        const onclick = [...cell.querySelectorAll("a")]
          .map((link) => link.getAttribute("onclick") || "")
          .find((value) => value.includes("syllabusRefer")) || "";
        const syllabus = parseSyllabusCall(onclick);
        const code = syllabus?.code || rows[0];
        courses.push({
          code,
          departmentCode: syllabus?.departmentCode || "",
          year: syllabus?.year || "",
          title: rows[1] || "",
          day: weekdays[index] || "",
          period,
          teacherAndRoom: rows[2] || "",
          syllabusUrl: syllabus
            ? `${BASE_URL}campussquare.do?_flowId=SYW0001000-flow&_eventId=syllabus&nendo=${syllabus.year}&jikanwarishozokucd=${syllabus.departmentCode}&jikanwaricd=${syllabus.code}`
            : "",
        });
      });
    }
  }

  const intensiveTable = doc.querySelector("table.rishu-etc");
  for (const row of intensiveTable?.querySelectorAll(":scope > tbody > tr") || []) {
    const cells = [...row.children].filter((cell) => cell.tagName === "TD");
    if (cells.length < 7) continue;
    const rawCode = normalize(cells[2]?.textContent);
    const title = normalize(cells[4]?.textContent);
    if (!rawCode || rawCode === "時間割コード" || !title) continue;
    const onclick = [...row.querySelectorAll("a")]
      .map((link) => link.getAttribute("onclick") || "")
      .find((value) => value.includes("syllabusRefer")) || "";
    const syllabus = parseSyllabusCall(onclick);
    const teacher = normalize(cells[5]?.textContent);
    const room = normalize(cells[6]?.textContent);
    courses.push({
      code: syllabus?.code || rawCode,
      departmentCode: syllabus?.departmentCode || "",
      year: syllabus?.year || "",
      title,
      day: normalize(cells[0]?.textContent).replace(/曜日$/, ""),
      period: normalize(cells[1]?.textContent),
      teacherAndRoom: [teacher, room].filter(Boolean).join(" / "),
      syllabusUrl: syllabus
        ? `${BASE_URL}campussquare.do?_flowId=SYW0001000-flow&_eventId=syllabus&nendo=${syllabus.year}&jikanwarishozokucd=${syllabus.departmentCode}&jikanwaricd=${syllabus.code}`
        : "",
      isIntensive: true,
    });
  }
  return courses;
}

function courseSlotTokens(course: CourseRegistration) {
  const encodedSlots = [...course.period.matchAll(/([月火水木金土日])\s*(\d+)/g)]
    .map((match) => `${match[1]}${match[2]}`);
  if (encodedSlots.length) return encodedSlots;

  const period = periodNumber(course.period);
  if (!period) return [];
  return course.day
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean)
    .map((day) => `${day}${period}`);
}

export function mergeCourses(items: CourseRegistration[]) {
  const grouped = new Map<string, CourseRegistration>();
  for (const item of items) {
    const current = grouped.get(item.code);
    if (!current) {
      grouped.set(item.code, item);
      continue;
    }
    const slots = new Set([
      ...courseSlotTokens(current),
      ...courseSlotTokens(item),
    ]);
    const days = [
      ...current.day.split(","),
      ...item.day.split(","),
    ].map((day) => day.trim()).filter(Boolean);
    grouped.set(item.code, {
      ...current,
      day: [...new Set(days)].join(","),
      period: slots.size ? [...slots].join(",") : current.period || item.period,
      isIntensive: Boolean(current.isIntensive && item.isIntensive),
    });
  }
  return [...grouped.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
}

function periodNumber(value: string) {
  return value.match(/\d+/)?.[0] || "";
}

function parseCellCourse(cell: Element) {
  const text = normalize(cell.textContent);
  const details = [...cell.querySelectorAll("td")]
    .map((item) => normalize(item.textContent))
    .filter(Boolean);
  const detail = details[details.length - 1];
  return detail || text;
}

function parseChanges(doc: Document): ChangeItem[] {
  const timetable = doc.querySelector("table.kyuko-kyukohoko");
  if (!timetable) return [];
  const dates = [...timetable.querySelectorAll("tr:first-child th")]
    .map((item) => normalize(item.textContent))
    .filter(Boolean);
  const typeByClass: Record<string, string> = {
    "kyuko-kyoshitsu": "教室変更",
    "kyuko-kyuko": "休講",
    "kyuko-hoko": "補講",
    "kyuko-jishu": "試験",
  };
  const changes: ChangeItem[] = [];
  const rows = [...timetable.querySelectorAll(":scope > tbody > tr")].slice(1, -1);
  for (const row of rows) {
    const period = normalize(row.querySelector("th")?.textContent);
    const cells = [...row.querySelectorAll(":scope > td")];
    cells.forEach((cell, index) => {
      const className = Object.keys(typeByClass).find((name) =>
        cell.classList.contains(name),
      );
      if (!className) return;
      changes.push({
        date: dates[index] || "",
        period,
        type: typeByClass[className],
        course: parseCellCourse(cell),
      });
    });
  }
  if (changes.length) return changes;
  return [
    ["教室変更", "kyuko-kyoshitsu"],
    ["休講", "kyuko-kyuko"],
    ["補講", "kyuko-hoko"],
    ["試験", "kyuko-jishu"],
  ]
    .map(([type, className]) => ({
      type,
      count: Math.max(0, doc.querySelectorAll(`.${className}`).length - 1),
    }))
    .filter((item) => item.count)
    .map((item) => ({
      type: item.type,
      date: "今週",
      period: "",
      course: `${item.count}件あります。詳細はKOANで確認してください。`,
    }));
}

function findBoardTable(doc: Document, unread: boolean) {
  return [...doc.querySelectorAll("table")].find((table) => {
    const text = normalize(table.textContent);
    return unread
      ? text.includes("表題 重要度") && text.includes("所属 氏名 掲示期間")
      : text.includes("ジャンル 表題 重要度") && text.includes("掲示期間");
  });
}

function parseNotices(doc: Document, responseUrl: string, unread = false): Notice[] {
  const table = findBoardTable(doc, unread);
  if (!table) return [];
  return [...table.querySelectorAll("tr")]
    .slice(1)
    .map((row) => {
      const cells = [...row.querySelectorAll("td")];
      const titleIndex = unread ? 0 : 1;
      const link = cells[titleIndex]?.querySelector("a");
      if (!link) return null;
      return {
        title: normalize(link.textContent),
        href: new URL(link.getAttribute("href") || "", responseUrl).href,
        genre: normalize(cells[unread ? 3 : 0]?.textContent) || "掲示",
        priority: normalize(cells[unread ? 1 : 2]?.textContent),
        unread,
        department: unread ? normalize(cells[4]?.textContent) : "",
        author: unread ? normalize(cells[5]?.textContent) : "",
        period: normalize(cells[unread ? 6 : 4]?.textContent),
        live: true,
      };
    })
    .filter((notice): notice is Notice => Boolean(notice));
}

export function noticeKey(notice: Notice) {
  const url = new URL(notice.href);
  return [
    url.searchParams.get("keijitype"),
    url.searchParams.get("genrecd"),
    url.searchParams.get("seqNo"),
  ].join(":");
}

export function mergeNotices(notices: Notice[]) {
  const merged = new Map<string, Notice>();
  for (const notice of notices) {
    const key = noticeKey(notice);
    const previous = merged.get(key);
    merged.set(key, {
      ...previous,
      ...notice,
      unread: Boolean(previous?.unread || notice.unread),
      department: notice.department || previous?.department || "",
      author: notice.author || previous?.author || "",
      live: Boolean(previous?.live || notice.live),
    });
  }
  return [...merged.values()];
}

export function attentionScore(notice: Notice) {
  return (
    (notice.unread ? 100 : 0) +
    (notice.isNew ? 45 : 0) +
    (notice.priority === "○" ? 25 : 0) +
    (/重要|要確認|締切|期限|停止|休講|変更|試験/.test(notice.title) ? 20 : 0) +
    (notice.genre === "個別連絡" ? 15 : 0)
  );
}

export async function refreshLight(
  previous: KoanData,
  options?: {
    force?: boolean;
    portalHtml?: string;
    portalUrl?: string;
    onProgress?: (value: string) => void;
  },
) {
  const force = Boolean(options?.force);
  requireRetryAvailable(LIGHT_FAILURE_KEY, "KOAN通常更新");
  if (!force) {
    requireCooldown(LIGHT_ATTEMPT_KEY, 60 * 1000, "通常更新の再試行は1分後にできます。");
  }
  const release = acquireLease(LIGHT_LEASE_KEY, 90 * 1000, "別の画面で通常更新中です。");
  localStorage.setItem(LIGHT_ATTEMPT_KEY, String(Date.now()));
  try {
    const onProgress = options?.onProgress;
    onProgress?.("KOANキャッシュを確認中");
    const completed = new Set<string>();
    const markDone = (label: string) => {
      completed.add(label);
      onProgress?.(`${[...completed].join(" / ")} 取得済み`);
    };
    const now = new Date().toISOString();
    const changesFresh = !force &&
      isFresh(koanPartUpdatedAt(previous, "changesUpdatedAt"), LIGHT_REFRESH_TTL_MS);
    const noticesFresh = !force &&
      isFresh(koanPartUpdatedAt(previous, "noticesUpdatedAt"), LIGHT_REFRESH_TTL_MS);
    const scheduleFresh = !force &&
      isFresh(koanPartUpdatedAt(previous, "scheduleUpdatedAt"), SCHEDULE_REFRESH_TTL_MS);
    const futureScheduleFresh = !force &&
      isFresh(
        koanPartUpdatedAt(previous, "futureScheduleUpdatedAt"),
        FUTURE_SCHEDULE_REFRESH_TTL_MS,
      );
    const coursesFresh = !force &&
      isFresh(koanPartUpdatedAt(previous, "coursesUpdatedAt"), COURSES_REFRESH_TTL_MS);
    const portal = options?.portalHtml
      ? {
        doc: new DOMParser().parseFromString(options.portalHtml, "text/html"),
        url: options.portalUrl || PORTAL_URL,
      }
      : await fetchHtml(PORTAL_URL);
    requireLogin(portal.doc);
    markDone("ポータル");
    const [scheduleResult, coursesResult, changesResult, boardResult] = await Promise.all([
      scheduleFresh && futureScheduleFresh
        ? Promise.resolve({
          pages: [] as Document[],
          updatedAt: koanPartUpdatedAt(previous, "scheduleUpdatedAt"),
          futureUpdatedAt: koanPartUpdatedAt(previous, "futureScheduleUpdatedAt"),
        }).then((result) => {
          markDone("時間割キャッシュ");
          return result;
        })
        : fetchScheduleRange(!futureScheduleFresh)
          .then((pages) => {
            markDone(!futureScheduleFresh ? "8週間時間割" : "当月時間割");
            return {
              pages,
              updatedAt: now,
              futureUpdatedAt: !futureScheduleFresh
                ? now
                : koanPartUpdatedAt(previous, "futureScheduleUpdatedAt"),
            };
          })
          .catch(() => {
            markDone("時間割キャッシュ");
            return {
              pages: [] as Document[],
              updatedAt: koanPartUpdatedAt(previous, "scheduleUpdatedAt"),
              futureUpdatedAt: koanPartUpdatedAt(previous, "futureScheduleUpdatedAt"),
            };
          }),
      coursesFresh
        ? Promise.resolve({
          courses: previous.courses,
          updatedAt: koanPartUpdatedAt(previous, "coursesUpdatedAt"),
        }).then((result) => {
          markDone("履修授業キャッシュ");
          return result;
        })
        : fetchHtml(COURSE_REGISTRATION_URL)
          .then((result) => {
            markDone("履修授業");
            return { courses: mergeCourses(parseCourseRegistrations(result.doc)), updatedAt: now };
          })
          .catch(() => {
            markDone("履修授業キャッシュ");
            return {
              courses: previous.courses,
              updatedAt: koanPartUpdatedAt(previous, "coursesUpdatedAt"),
            };
          }),
      changesFresh
        ? Promise.resolve({
          changes: previous.changes,
          updatedAt: koanPartUpdatedAt(previous, "changesUpdatedAt"),
        }).then((result) => {
          markDone("休講補講キャッシュ");
          return result;
        })
        : fetchHtml(CHANGES_URL).then((result) => {
          markDone("休講補講");
          return { changes: parseChanges(result.doc), updatedAt: now };
        }),
      noticesFresh
        ? Promise.resolve({
          board: null,
          updatedAt: koanPartUpdatedAt(previous, "noticesUpdatedAt"),
        }).then((result) => {
          markDone("新着掲示キャッシュ");
          return result;
        })
        : fetchHtml(BOARD_URL).then((board) => {
          markDone("新着掲示");
          return { board, updatedAt: now };
        }),
    ]);
    onProgress?.("取得結果を整理中");
    const oldKeys = new Set(previous.notices.map(noticeKey));
    const unread = boardResult.board
      ? parseNotices(boardResult.board.doc, boardResult.board.url, true).map((notice) => ({
        ...notice,
        isNew: !oldKeys.has(noticeKey(notice)),
      }))
      : [];
    const schedule = scheduleResult.pages.length
      ? mergeCurrentSchedule(
        scheduleResult.pages,
        previous.schedule,
        !futureScheduleFresh,
      )
      : previous.schedule;
    const notices = boardResult.board
      ? mergeNotices([
        ...previous.notices.map((notice) => ({
          ...notice,
          isNew: false,
          live: false,
          unread: false,
        })),
        ...unread,
      ])
      : previous.notices;
    const lightUpdatedAt = latestTimestamp([
      scheduleResult.updatedAt,
      scheduleResult.futureUpdatedAt,
      coursesResult.updatedAt,
      changesResult.updatedAt,
      boardResult.updatedAt,
    ]);
    const result = {
      schedule: schedule.length ? schedule : parseSchedule(portal.doc),
      courses: coursesResult.courses,
      changes: changesResult.changes,
      notices,
      lightUpdatedAt,
      scheduleUpdatedAt: scheduleResult.updatedAt,
      futureScheduleUpdatedAt: scheduleResult.futureUpdatedAt,
      coursesUpdatedAt: coursesResult.updatedAt,
      changesUpdatedAt: changesResult.updatedAt,
      noticesUpdatedAt: boardResult.updatedAt,
    };
    localStorage.removeItem(LIGHT_FAILURE_KEY);
    return result;
  } catch (error) {
    recordFailure(LIGHT_FAILURE_KEY);
    throw error;
  } finally {
    options?.onProgress?.("");
    release();
  }
}

async function fetchGenre(
  root: { doc: Document; url: string },
  genre: string,
  deadline: number,
) {
  requireTimeBudget(deadline, "掲示同期は3分で中断しました。時間を置いて再試行してください。");
  const link = [...root.doc.querySelectorAll("a")].find(
    (item) => normalize(item.textContent) === genre,
  );
  if (!link) return [];
  await pause(BOARD_REQUEST_GAP_MS);
  requireTimeBudget(deadline, "掲示同期は3分で中断しました。時間を置いて再試行してください。");
  let page = await fetchHtml(new URL(link.getAttribute("href") || "", root.url).href);
  const notices: Notice[] = [];
  const visited = new Set<string>();
  for (let index = 0; index < MAX_BOARD_PAGES_PER_GENRE; index += 1) {
    const pageNotices = parseNotices(page.doc, page.url);
    notices.push(...pageNotices);
    const next = [...page.doc.querySelectorAll("a")].find(
      (item) => normalize(item.textContent) === "次へ >>",
    );
    if (!next || index === MAX_BOARD_PAGES_PER_GENRE - 1) break;
    const nextUrl = new URL(next.getAttribute("href") || "", page.url).href;
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    await pause(BOARD_REQUEST_GAP_MS);
    requireTimeBudget(deadline, "掲示同期は3分で中断しました。時間を置いて再試行してください。");
    page = await fetchHtml(nextUrl);
  }
  return notices;
}

export async function refreshSnapshot(
  previous: KoanData,
  onProgress?: (value: string) => void,
) {
  requireRetryAvailable(SNAPSHOT_FAILURE_KEY, "掲示同期");
  requireCooldown(SNAPSHOT_COMPLETED_KEY, SNAPSHOT_TTL_MS, "掲示同期は6時間に1回までです。");
  requireCooldown(SNAPSHOT_ATTEMPT_KEY, 10 * 60 * 1000, "掲示同期の再試行は10分後にできます。");
  requireNoActiveLease(NOTICE_RESOLVE_LEASE_KEY, "掲示を検索中です。完了後に同期してください。");
  const release = acquireLease(SNAPSHOT_LEASE_KEY, SNAPSHOT_MAX_DURATION_MS + REQUEST_TIMEOUT_MS, "別の画面で掲示を同期中です。");
  try {
    const notices: Notice[] = [];
    const deadline = Date.now() + SNAPSHOT_MAX_DURATION_MS;
    const root = await fetchHtml(BOARD_URL);
    if (new URL(root.url).origin !== "https://koan.osaka-u.ac.jp") {
      throw new Error("KOANにログインしてから更新してください。");
    }
    localStorage.setItem(SNAPSHOT_ATTEMPT_KEY, String(Date.now()));
    const syncAt = new Date().toISOString();
    const snapshotGenreSyncAt = { ...(previous.snapshotGenreSyncAt || {}) };
    for (const [index, genre] of GENRES.entries()) {
      onProgress?.(`${index + 1}/${GENRES.length} ${genre}`);
      notices.push(...(await fetchGenre(root, genre, deadline)));
      snapshotGenreSyncAt[genre] = syncAt;
      await pause(BOARD_REQUEST_GAP_MS);
      requireTimeBudget(deadline, "掲示同期は3分で中断しました。時間を置いて再試行してください。");
    }
    localStorage.setItem(SNAPSHOT_COMPLETED_KEY, String(Date.now()));
    onProgress?.("");
    const result = {
      notices: mergeNotices(notices),
      snapshotUpdatedAt: syncAt,
      snapshotVersion: NOTICE_SNAPSHOT_VERSION,
      snapshotGenreSyncAt,
    };
    localStorage.removeItem(SNAPSHOT_FAILURE_KEY);
    return result;
  } catch (error) {
    recordFailure(SNAPSHOT_FAILURE_KEY);
    throw error;
  } finally {
    release();
  }
}

type NoticeUrlCacheEntry = {
  url: string | null;
  expiresAt: number;
};

function readNoticeUrlCache() {
  try {
    return JSON.parse(localStorage.getItem(NOTICE_URL_CACHE_KEY) || "{}") as Record<
      string,
      NoticeUrlCacheEntry
    >;
  } catch {
    return {};
  }
}

function cacheNoticeUrl(key: string, url: string | null) {
  const cache = readNoticeUrlCache();
  const now = Date.now();
  for (const [cachedKey, entry] of Object.entries(cache)) {
    if (!entry || entry.expiresAt <= now) delete cache[cachedKey];
  }
  cache[key] = {
    url,
    expiresAt: now + (url ? NOTICE_URL_TTL_MS : NOTICE_URL_FAILURE_TTL_MS),
  };
  localStorage.setItem(NOTICE_URL_CACHE_KEY, JSON.stringify(cache));
}

async function findNoticeUrl(
  notice: Notice,
  snapshotNotices: Notice[],
): Promise<string | null> {
  requireRetryAvailable(NOTICE_RESOLVE_FAILURE_KEY, "掲示の検索");
  requireNoActiveLease(SNAPSHOT_LEASE_KEY, "掲示同期中です。完了後に掲示を開いてください。");
  const release = acquireLease(NOTICE_RESOLVE_LEASE_KEY, NOTICE_RESOLVE_MAX_DURATION_MS + REQUEST_TIMEOUT_MS, "別の掲示を検索中です。");
  try {
    const deadline = Date.now() + NOTICE_RESOLVE_MAX_DURATION_MS;
    const target = noticeKey(notice);
    localStorage.setItem(`${NOTICE_RESOLVE_ATTEMPT_KEY}:${target}`, String(Date.now()));
    const snapshotMatch = snapshotNotices.find(
      (candidate) => noticeKey(candidate) === target && candidate.live && candidate.href,
    );
    if (snapshotMatch) {
      localStorage.removeItem(NOTICE_RESOLVE_FAILURE_KEY);
      return snapshotMatch.href;
    }

    const root = await fetchHtml(BOARD_URL);
    const unreadMatch = parseNotices(root.doc, root.url, true).find(
      (candidate) => noticeKey(candidate) === target,
    );
    if (unreadMatch) {
      localStorage.removeItem(NOTICE_RESOLVE_FAILURE_KEY);
      return unreadMatch.href;
    }

    const genreLink = [...root.doc.querySelectorAll("a")].find(
      (item) => normalize(item.textContent) === notice.genre,
    );
    if (!genreLink) {
      localStorage.removeItem(NOTICE_RESOLVE_FAILURE_KEY);
      return null;
    }

    let page = await fetchHtml(
      new URL(genreLink.getAttribute("href") || "", root.url).href,
    );
    const visited = new Set<string>();
    for (let index = 0; index < MAX_BOARD_PAGES_PER_GENRE; index += 1) {
      const match = parseNotices(page.doc, page.url).find(
        (candidate) => noticeKey(candidate) === target,
      );
      if (match) {
        localStorage.removeItem(NOTICE_RESOLVE_FAILURE_KEY);
        return match.href;
      }
      const next = [...page.doc.querySelectorAll("a")].find(
        (item) => normalize(item.textContent) === "次へ >>",
      );
      if (!next || index === MAX_BOARD_PAGES_PER_GENRE - 1) break;
      const nextUrl = new URL(next.getAttribute("href") || "", page.url).href;
      if (visited.has(nextUrl)) break;
      visited.add(nextUrl);
      await pause(BOARD_REQUEST_GAP_MS);
      requireTimeBudget(deadline, "掲示の検索は1分で中断しました。掲示板から直接開いてください。");
      page = await fetchHtml(nextUrl);
    }
    localStorage.removeItem(NOTICE_RESOLVE_FAILURE_KEY);
    return null;
  } catch (error) {
    recordFailure(NOTICE_RESOLVE_FAILURE_KEY);
    throw error;
  } finally {
    release();
  }
}

export async function resolveNoticeUrl(
  notice: Notice,
  snapshotNotices: Notice[] = [],
): Promise<string | null> {
  const key = noticeKey(notice);
  const cached = readNoticeUrlCache()[key];
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const existing = noticeResolveRequests.get(key);
  if (existing) return existing;
  requireCooldown(`${NOTICE_RESOLVE_ATTEMPT_KEY}:${key}`, 10 * 1000, "この掲示を開く操作は10秒後に再試行できます。");
  const request = findNoticeUrl(notice, snapshotNotices)
    .then((url) => {
      cacheNoticeUrl(key, url);
      return url;
    });
  noticeResolveRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (noticeResolveRequests.get(key) === request) noticeResolveRequests.delete(key);
  }
}

async function submitFullRangeFlow(url: string, tabId?: number) {
  const initial = await fetchHtmlFromKoanTab(url, undefined, tabId);
  const form = initial.doc.querySelector<HTMLFormElement>(
    'form input[name="_flowExecutionKey"]',
  )?.closest("form");
  const executionKey = form
    ?.querySelector<HTMLInputElement>('input[name="_flowExecutionKey"]')
    ?.value;
  if (!form || !executionKey) {
    throw new Error("成績照会画面を開始できませんでした。KOANを再読み込みしてから取得してください。");
  }
  const params = new URLSearchParams({
    _flowExecutionKey: executionKey,
    _eventId: "display",
    dummy: "",
    spanType: "0",
    nendo: form.querySelector<HTMLInputElement>('input[name="nendo"]')?.value || "",
    gakkiKbnCd:
      form.querySelector<HTMLSelectElement>('select[name="gakkiKbnCd"]')?.value ||
      "3",
  });
  return fetchHtmlFromKoanTab(
    `${BASE_URL}campussquare.do`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: params.toString(),
    },
    initial.tabId,
  );
}

function parseGradeHistory(doc: Document): GradeHistoryItem[] {
  const table = findTable(doc, ["時間割コード", "開講科目名", "教員氏名", "評語", "合否"]);
  return directRows(table)
    .map(cells)
    .filter((row) => row.length >= 9)
    .map((row) => ({
      code: row[1],
      course: row[2],
      teacher: row[5],
      year: row[6],
      grade: row[7],
      pass: row[8],
    }));
}

function parseCreditCourses(doc: Document): CreditCourse[] {
  const table = findTable(doc, ["科目詳細区分", "科目小区分", "科目名", "単位数", "合否"]);
  return directRows(table)
    .map(cells)
    .filter((row) => row.length >= 11)
    .map((row) => ({
      majorCategory: row[1],
      minorCategory: row[2] || "未分類",
      course: row[3],
      credits: parseNumber(row[6]),
      year: row[7],
      term: row[8],
      grade: row[9],
      pass: row[10],
    }));
}

function isEarnedCredit(course: CreditCourse) {
  return course.credits > 0 && /^(合|認|認定)$/.test(course.pass);
}

function parseCreditsTotal(doc: Document) {
  const heading = [...doc.querySelectorAll("th")].find(
    (cell) => normalize(cell.textContent) === "修得単位数",
  );
  if (!heading) return null;
  const value = normalize(heading.nextElementSibling?.textContent);
  return value ? parseNumber(value) : null;
}

function parseTermGpas(doc: Document): TermGpa[] {
  const table = findTable(doc, ["年度", "学期", "ＧＰＡ", "計算日時"]);
  return directRows(table)
    .map(cells)
    .filter((row) => row.length >= 3)
    .map((row) => ({ year: row[0], term: row[1], gpa: row[2] }));
}

function parseCumulativeGpa(doc: Document) {
  const table = [...doc.querySelectorAll("table")].find((candidate) => {
    const headers = [...candidate.querySelectorAll("th")].map((cell) =>
      normalize(cell.textContent),
    );
    return headers.includes("ＧＰＡ") && headers.includes("計算日時") && !headers.includes("年度");
  });
  return table ? cells(directRows(table)[0] || table)[0] || "" : "";
}

function groupCredits(courses: CreditCourse[]): CreditGroup[] {
  const groups = new Map<string, CreditCourse[]>();
  for (const course of courses) {
    groups.set(course.minorCategory, [...(groups.get(course.minorCategory) || []), course]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      credits: items.reduce((sum, item) => sum + item.credits, 0),
      courses: items,
    }))
    .sort((a, b) => b.credits - a.credits || a.name.localeCompare(b.name, "ja"));
}

export async function refreshGrades(
  onProgress?: (message: string) => void,
  tabId?: number,
): Promise<GradeData> {
  requireCooldown(GRADES_ATTEMPT_KEY, 60 * 1000, "成績取得の再試行は1分後にできます。");
  const release = acquireLease(GRADES_LEASE_KEY, 90 * 1000, "別の画面で成績を取得中です。");
  localStorage.setItem(GRADES_ATTEMPT_KEY, String(Date.now()));
  try {
  // KOAN stores these old Web Flow screens in a shared session. Keep them sequential.
  onProgress?.("履修成績を取得中");
  const gradeHistory = await submitFullRangeFlow(GRADE_HISTORY_URL, tabId);
  onProgress?.("単位修得状況を取得中");
  const creditStatus = await submitFullRangeFlow(CREDIT_STATUS_URL, gradeHistory.tabId);
  const courses = parseCreditCourses(creditStatus.doc).filter(isEarnedCredit);
  return {
    creditsTotal: parseCreditsTotal(creditStatus.doc),
    cumulativeGpa: parseCumulativeGpa(creditStatus.doc),
    termGpas: parseTermGpas(creditStatus.doc),
    groups: groupCredits(courses),
    courses,
    history: parseGradeHistory(gradeHistory.doc),
    updatedAt: new Date().toISOString(),
  };
  } finally {
    release();
  }
}

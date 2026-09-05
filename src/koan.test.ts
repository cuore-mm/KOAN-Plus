import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLease,
  cleanupNoticeResolveAttempts,
  mergeCourses,
  mergeNotices,
  NOTICE_CACHE_MAX_ITEMS,
  NOTICE_CACHE_WARNING_THRESHOLD,
  noticeKey,
  parseChangeHeaderDate,
  parseKoanSurveyPeriod,
  parseNotices,
  refreshGrades,
  refreshLight,
  refreshSnapshot,
  resolveNoticeUrl,
  retainNotices,
  type CourseRegistration,
  type KoanData,
  type Notice,
} from "./koan";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) || null,
    key: (index: number) => [...values.keys()][index] || null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

function stubUnavailableLocalStorage() {
  const unavailable = () => {
    throw new Error("storage unavailable");
  };
  vi.stubGlobal("localStorage", {
    get length() {
      return unavailable();
    },
    getItem: unavailable,
    key: unavailable,
    removeItem: unavailable,
    setItem: unavailable,
  });
}

function freshKoanData(): KoanData {
  const updatedAt = new Date().toISOString();
  return {
    schedule: [],
    courses: [],
    changes: [],
    surveys: [],
    notices: [],
    lightUpdatedAt: updatedAt,
    snapshotUpdatedAt: updatedAt,
    scheduleUpdatedAt: updatedAt,
    futureScheduleUpdatedAt: updatedAt,
    coursesUpdatedAt: updatedAt,
    changesUpdatedAt: updatedAt,
    futureChangesUpdatedAt: updatedAt,
    surveysUpdatedAt: updatedAt,
    noticesUpdatedAt: updatedAt,
  };
}

function course(
  code: string,
  day: string,
  period: string,
  isIntensive = false,
): CourseRegistration {
  return {
    code,
    day,
    period,
    isIntensive,
    departmentCode: "",
    syllabusUrl: "",
    teacherAndRoom: "",
    title: code,
    year: "2025",
  };
}

function notice(id: string, overrides: Partial<Notice> = {}): Notice {
  return {
    title: `掲示 ${id}`,
    href: `https://koan.osaka-u.ac.jp/notice?id=${encodeURIComponent(id)}`,
    genre: "授業",
    priority: "",
    unread: false,
    department: "",
    author: "",
    period: "",
    live: false,
    ...overrides,
  };
}

function boardDocument(headers: string | string[], values: string[], titleIndex: number) {
  const link = {
    textContent: values[titleIndex],
    getAttribute: (name: string) => name === "href"
      ? "campusportal.do?flow=confirm&event=confirm&keijitype=1&genrecd=2&seqNo=3"
      : null,
  };
  const cells = values.map((value, index) => ({
    textContent: value,
    querySelector: (selector: string) => selector === "a" && index === titleIndex ? link : null,
  }));
  const headerValues = Array.isArray(headers) ? headers : [headers];
  const headerRow = {
    textContent: headerValues.join(""),
    querySelectorAll: (selector: string) =>
      selector === ":scope > th, :scope > td"
        ? headerValues.map((value) => ({ textContent: value }))
        : [],
  };
  const dataRow = {
    textContent: values.join(""),
    querySelectorAll: (selector: string) => selector === "td" ? cells : [],
  };
  const table = {
    querySelectorAll: (selector: string) => selector === "tr" ? [headerRow, dataRow] : [],
  };
  return {
    querySelectorAll: (selector: string) => selector === "table" ? [table] : [],
  } as unknown as Document;
}

describe("mergeCourses", () => {
  it("preserves every slot when the same course has three or more meetings", () => {
    const [merged] = mergeCourses([
      course("ABC001", "月", "1限"),
      course("ABC001", "水", "2限"),
      course("ABC001", "金", "3限"),
    ]);

    expect(merged.day).toBe("月,水,金");
    expect(merged.period).toBe("月1,水2,金3");
  });

  it("keeps a mixed regular/intensive course on the regular timetable", () => {
    const [merged] = mergeCourses([
      course("ABC001", "月", "1限"),
      course("ABC001", "集中", "随時", true),
    ]);

    expect(merged.isIntensive).toBe(false);
    expect(merged.period).toBe("月1");
  });
});

describe("noticeKey", () => {
  it("does not collapse notices when KOAN changes its query parameter names", () => {
    const notice = (href: string): Notice => ({
      title: href,
      href,
      genre: "授業",
      priority: "",
      unread: false,
      department: "",
      author: "",
      period: "",
      live: true,
    });

    expect(noticeKey(notice("https://koan.osaka-u.ac.jp/notice?id=1")))
      .not.toBe(noticeKey(notice("https://koan.osaka-u.ac.jp/notice?id=2")));
  });
});

describe("bulletin table parsing", () => {
  it("accepts KOAN's concatenated header-cell layout", () => {
    const doc = boardDocument(
      "ジャンル表題重要度所属氏名掲示期間",
      ["授業", "授業のお知らせ", "", "", "", "", "2026/09/05"],
      1,
    );

    expect(parseNotices(doc, "https://koan.osaka-u.ac.jp/campusweb/")).toMatchObject([{
      title: "授業のお知らせ",
      genre: "授業",
      href: "https://koan.osaka-u.ac.jp/campusweb/campusportal.do?flow=confirm&event=confirm&keijitype=1&genrecd=2&seqNo=3",
    }]);
  });

  it("maps the live 授業 board columns by their headers", () => {
    const doc = boardDocument(
      ["ジャンル", "曜日・時限", "開講科目名", "担当者", "表題", "重要度", "掲示期間", "掲載者"],
      ["授業", "月1", "脳科学", "牧瀬", "休講のお知らせ", "○", "2026/09/05", "教務"],
      4,
    );

    expect(parseNotices(doc, "https://koan.osaka-u.ac.jp/campusweb/")).toMatchObject([{
      title: "休講のお知らせ",
      genre: "授業",
      priority: "○",
      period: "2026/09/05",
    }]);
  });
});

describe("parseChangeHeaderDate", () => {
  it("uses the date printed in the KOAN table header", () => {
    expect(parseChangeHeaderDate("8/3(月)", new Date(2026, 7, 6, 12))).toBe("2026-08-03");
  });

  it("handles a year boundary when the header omits the year", () => {
    expect(parseChangeHeaderDate("12/29(月)", new Date(2026, 0, 2, 12))).toBe("2025-12-29");
    expect(parseChangeHeaderDate("1/5(月)", new Date(2025, 11, 29, 12))).toBe("2026-01-05");
  });

  it("preserves an explicit year from the header", () => {
    expect(parseChangeHeaderDate("2026年8月3日(月)", new Date(2027, 0, 1, 12))).toBe("2026-08-03");
  });
});

describe("parseKoanSurveyPeriod", () => {
  it("converts a Japanese survey period from JST to stable ISO timestamps", () => {
    expect(parseKoanSurveyPeriod(
      "2026年07月10日10時 - 2026年08月31日23時",
    )).toEqual({
      startAt: "2026-07-10T01:00:00.000Z",
      endAt: "2026-08-31T14:00:00.000Z",
    });
  });
});

describe("localStorage leases", () => {
  it("does not let an old owner release a replacement lease", () => {
    const values = stubLocalStorage();
    const release = acquireLease("test-lease", 60_000, "busy");
    values.set("test-lease", JSON.stringify({
      expiresAt: Date.now() + 60_000,
      owner: "new-owner",
    }));

    release();

    expect(values.get("test-lease")).toContain("new-owner");
  });

  it("blocks active legacy timestamp leases and upgrades expired ones", () => {
    const values = stubLocalStorage();
    values.set("legacy-lease", String(Date.now() + 60_000));
    expect(() => acquireLease("legacy-lease", 60_000, "busy")).toThrow("busy");

    values.set("legacy-lease", String(Date.now() - 1));
    const release = acquireLease("legacy-lease", 60_000, "busy");
    expect(JSON.parse(values.get("legacy-lease") || "{}")).toMatchObject({
      owner: expect.any(String),
    });
    release();
    expect(values.get("legacy-lease")).toBeUndefined();
  });
});

describe("best-effort coordination storage", () => {
  it("keeps a fresh light refresh running when every storage operation throws", async () => {
    stubUnavailableLocalStorage();
    vi.stubGlobal("DOMParser", class {
      parseFromString() {
        return {
          getElementById: (id: string) => id === "portal-body" ? {} : null,
          querySelector: () => null,
        };
      }
    });

    await expect(refreshLight(freshKoanData(), {
      portalHtml: "<div id=\"portal-body\"></div>",
    })).resolves.toMatchObject({
      schedule: [],
      courses: [],
      changes: [],
      surveys: [],
      notices: [],
    });
  });

  it("does not turn snapshot network failure into a storage failure", async () => {
    stubUnavailableLocalStorage();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("snapshot fixture network")));

    await expect(refreshSnapshot(freshKoanData())).rejects.toThrow("snapshot fixture network");
  });

  it("does not turn grades network failure into a storage failure", async () => {
    stubUnavailableLocalStorage();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: false, error: "grades fixture network" }),
      },
    });

    await expect(refreshGrades(undefined, 1)).rejects.toThrow("grades fixture network");
  });

  it("does not turn notice URL lookup network failure into a storage failure", async () => {
    stubUnavailableLocalStorage();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("notice fixture network")));

    await expect(resolveNoticeUrl(notice("storage-unavailable"))).rejects.toThrow("notice fixture network");
  });
});

describe("notice URL cache", () => {
  it("treats an unexpired null result as a negative cache hit", async () => {
    const values = stubLocalStorage();
    const target = notice("negative");
    values.set("koan-plus-notice-url-cache-v1", JSON.stringify({
      [noticeKey(target)]: { url: null, expiresAt: Date.now() + 60_000 },
    }));

    await expect(resolveNoticeUrl(target)).resolves.toBeNull();
    expect(values.has("koan-plus-notice-resolve-lease-v1")).toBe(false);
  });
});

describe("notice resolve attempt retention", () => {
  it("removes expired dynamic keys but keeps active and static keys", () => {
    const values = stubLocalStorage();
    const prefix = "koan-plus-notice-resolve-attempt-v1:";
    values.set(`${prefix}old`, String(Date.now() - 11_000));
    values.set(`${prefix}fresh`, String(Date.now() - 1_000));
    values.set("koan-plus-notice-resolve-attempt-v1", String(Date.now()));

    expect(cleanupNoticeResolveAttempts()).toBe(1);
    expect(values.has(`${prefix}old`)).toBe(false);
    expect(values.has(`${prefix}fresh`)).toBe(true);
    expect(values.has("koan-plus-notice-resolve-attempt-v1")).toBe(true);
  });
});

describe("notice cache retention", () => {
  it("warns at the soft limit without deleting records", () => {
    const notices = Array.from(
      { length: NOTICE_CACHE_WARNING_THRESHOLD + 1 },
      (_, index) => notice(`soft-${index}`),
    );

    const result = retainNotices(notices);

    expect(result.notices).toHaveLength(NOTICE_CACHE_WARNING_THRESHOLD + 1);
    expect(result.dropped).toBe(0);
    expect(result.warnings[0]).toContain(`${NOTICE_CACHE_WARNING_THRESHOLD}件`);
  });

  it("drops old read non-live records before protected notices at the hard limit", () => {
    const oldRead = notice("old-read");
    const bulk = Array.from(
      { length: NOTICE_CACHE_MAX_ITEMS },
      (_, index) => notice(`bulk-${index}`),
    );
    const protectedNotices = [
      notice("unread", { unread: true }),
      notice("live", { live: true }),
      notice("important", { priority: "○" }),
    ];

    const result = retainNotices([oldRead, ...bulk, ...protectedNotices]);

    expect(result.notices).toHaveLength(NOTICE_CACHE_MAX_ITEMS);
    expect(result.dropped).toBe(4);
    expect(result.notices.map(noticeKey)).not.toContain(noticeKey(oldRead));
    for (const protectedNotice of protectedNotices) {
      expect(result.notices.map(noticeKey)).toContain(noticeKey(protectedNotice));
    }
    expect(result.warnings.join(" ")).toContain("整理しました");
  });

  it("applies the same bound through mergeNotices and reports warnings", () => {
    const warnings: string[] = [];
    const notices = Array.from(
      { length: NOTICE_CACHE_MAX_ITEMS + 1 },
      (_, index) => notice(`merge-${index}`),
    );

    const merged = mergeNotices(notices, warnings);

    expect(merged).toHaveLength(NOTICE_CACHE_MAX_ITEMS);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

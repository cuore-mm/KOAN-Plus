import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CLE_DATA,
  fetchAllResults,
  gradebookColumnsToTasks,
  isCleCacheFresh,
  resolveActiveCleCourses,
  resolveTaskStatus,
  resolveTaskStatusEvidence,
  selectTaskStatusTargets,
  type CleCourse,
  type CleTask,
} from "./cle";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAllResults", () => {
  it("follows paging.nextPage instead of silently keeping the first page", async () => {
    vi.stubGlobal("window", globalThis);
    const sendMessage = vi.fn(async (message: any) => {
      const offset = new URL(message.request.url).searchParams.get("offset");
      const payload = offset === "2"
        ? { results: [{ id: "third" }], paging: {} }
        : {
          results: [{ id: "first" }, { id: "second" }],
          paging: { nextPage: "/learn/api/public/v1/example?offset=2&limit=2" },
        };
      return {
        ok: true,
        response: {
          ok: true,
          status: 200,
          text: JSON.stringify(payload),
        },
      };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    const records = await fetchAllResults(
      "https://www.cle.osaka-u.ac.jp/learn/api/public/v1/example?offset=0&limit=2",
    );

    expect(records.map((record) => record.id)).toEqual(["first", "second", "third"]);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful response whose list shape is missing", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          response: {
            ok: true,
            status: 200,
            text: JSON.stringify({ unexpected: [] }),
          },
        })),
      },
    });

    await expect(fetchAllResults(
      "https://www.cle.osaka-u.ac.jp/learn/api/public/v1/example?limit=100",
      undefined,
      "テスト一覧",
    )).rejects.toThrow("応答形式");
  });
});

describe("isCleCacheFresh", () => {
  it("keeps a cache stale while announcement or task-status batches remain", () => {
    const now = new Date().toISOString();
    const base = {
      ...EMPTY_CLE_DATA,
      coursesUpdatedAt: now,
      tasksUpdatedAt: now,
      messagesUpdatedAt: now,
      taskStatusesUpdatedAt: now,
    };

    expect(isCleCacheFresh({
      ...base,
      announcementsPendingCount: 1,
    })).toBe(false);
    expect(isCleCacheFresh({
      ...base,
      taskStatusPendingCount: 1,
    })).toBe(false);
    expect(isCleCacheFresh({
      ...base,
      announcementsPendingCount: 0,
      taskStatusPendingCount: 0,
    })).toBe(true);
  });
});

describe("gradebookColumnsToTasks", () => {
  const course = {
    courseId: "_123_1",
    name: "テスト科目",
  };

  it("keeps content-linked gradebook items that have no due date", () => {
    const tasks = gradebookColumnsToTasks(course, [
      {
        id: "_456_1",
        name: "期限なしレポート",
        contentId: "_789_1",
        grading: {},
      },
    ]);

    expect(tasks).toEqual([
      {
        id: "_456_1",
        courseId: "_123_1",
        courseName: "テスト科目",
        title: "期限なしレポート",
        dueAt: null,
        status: "状態不明",
      },
    ]);
  });

  it("keeps dated content items outside the calendar window", () => {
    const tasks = gradebookColumnsToTasks(course, [
      {
        id: "dated",
        name: "期限あり",
        contentId: "content-1",
        grading: { due: "2026-08-01T00:00:00.000Z" },
      },
    ]);

    expect(tasks).toMatchObject([
      {
        id: "dated",
        dueAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("keeps the possible score for displaying a posted grade", () => {
    const tasks = gradebookColumnsToTasks(course, [
      {
        id: "scored",
        name: "小テスト",
        contentId: "content-2",
        score: { possible: 20 },
        grading: {},
      },
    ]);

    expect(tasks[0]).toMatchObject({
      id: "scored",
      possibleScore: 20,
    });
  });

  it("omits overall-grade and unlinked manual columns", () => {
    const tasks = gradebookColumnsToTasks(course, [
      {
        id: "overall",
        name: "総合成績",
        contentId: "content-2",
        externalGrade: true,
        grading: {},
      },
      {
        id: "manual",
        name: "手動列",
        grading: {},
      },
    ]);

    expect(tasks).toEqual([]);
  });
});

describe("resolveActiveCleCourses", () => {
  const cleCourse = (
    courseId: string,
    displayId: string,
    name: string,
  ): CleCourse => ({
    courseId,
    displayId,
    timetableCode: displayId.match(/^\d{4}-\d{2}-(\d{6})-/)?.[1] || "",
    name,
    available: true,
  });

  it("selects only the KOAN course from the matching academic year", () => {
    const resolved = resolveActiveCleCourses(
      [
        cleCourse("old", "2025-01-123456-01", "情報社会基礎"),
        cleCourse("current", "2026-01-123456-01", "情報社会基礎"),
        cleCourse("unrelated", "2026-01-999999-01", "総合英語"),
      ],
      [{ code: "123456", title: "情報社会基礎", year: "2026" }],
    );

    expect(resolved.map((course) => course.courseId)).toEqual(["current"]);
  });

  it("uses the course name for a same-year parent course", () => {
    const resolved = resolveActiveCleCourses(
      [
        cleCourse("child", "2026-01-123456-01", "【取消】情報社会基礎"),
        cleCourse("parent", "2026-01-654321-01", "情報社会基礎"),
      ].map((course) =>
        course.courseId === "child" ? { ...course, available: false } : course,
      ),
      [{ code: "123456", title: "情報社会基礎", year: "2026" }],
    );

    expect(resolved.map((course) => course.courseId)).toEqual(["parent"]);
  });

  it("keeps a same-year parent course even when it has no timetable code", () => {
    const resolved = resolveActiveCleCourses(
      [{
        courseId: "parent",
        displayId: "2026-01-PARENT-01",
        timetableCode: "",
        name: "情報社会基礎",
        available: true,
      }],
      [{ code: "123456", title: "情報社会基礎", year: "2026" }],
    );

    expect(resolved.map((course) => course.courseId)).toEqual(["parent"]);
  });
});

describe("resolveTaskStatus", () => {
  it("recognizes a posted grade even when the attempts request is unavailable", () => {
    expect(resolveTaskStatus(
      null,
      { status: "Graded", score: 20 },
      "2026-06-13T14:59:00.000Z",
    )).toBe("採点済み");
  });

  it("recognizes a completed scored attempt when the grade request is unavailable", () => {
    expect(resolveTaskStatus(
      { results: [{ status: "Completed", score: 0 }] },
      null,
      "2026-06-13T14:59:00.000Z",
    )).toBe("採点済み");
  });

  it("keeps an ungraded attempt as submitted", () => {
    expect(resolveTaskStatus(
      { results: [{ status: "NeedsGrading" }] },
      null,
      "2026-06-13T14:59:00.000Z",
    )).toBe("提出済み");
  });

  it("finds a graded attempt even when it is not the first result", () => {
    expect(resolveTaskStatus(
      {
        results: [
          { status: "InProgress" },
          { status: "Completed", score: 15 },
        ],
      },
      null,
      "2026-06-13T14:59:00.000Z",
    )).toBe("採点済み");
  });
});

describe("resolveTaskStatusEvidence", () => {
  it("does not infer an overdue state from one empty response and one failure", () => {
    expect(resolveTaskStatusEvidence({
      attemptsResponse: { results: [] },
      attemptsSucceeded: true,
      dueAt: "2026-06-13T14:59:00.000Z",
      gradeResponse: null,
      gradeSucceeded: false,
    })).toMatchObject({
      status: null,
      verified: false,
    });
  });

  it("accepts positive grading evidence from only one successful endpoint", () => {
    expect(resolveTaskStatusEvidence({
      attemptsResponse: null,
      attemptsSucceeded: false,
      dueAt: "2026-06-13T14:59:00.000Z",
      gradeResponse: { status: "Graded", score: 20 },
      gradeSucceeded: true,
    })).toEqual({
      score: 20,
      status: "採点済み",
      verified: true,
    });
  });

  it("infers an overdue state only after both endpoints return successfully", () => {
    expect(resolveTaskStatusEvidence({
      attemptsResponse: { results: [] },
      attemptsSucceeded: true,
      dueAt: "2026-06-13T14:59:00.000Z",
      gradeResponse: {},
      gradeSucceeded: true,
    })).toMatchObject({
      status: "期限切れ",
      verified: true,
    });
  });
});

describe("selectTaskStatusTargets", () => {
  const task = (index: number, overrides: Partial<CleTask> = {}): CleTask => ({
    id: `task-${String(index).padStart(2, "0")}`,
    courseId: "course-1",
    courseName: "テスト科目",
    title: `課題${index}`,
    dueAt: null,
    status: "状態不明",
    ...overrides,
  });

  it("rotates forced refreshes instead of checking the same first 12 tasks", () => {
    const tasks = Array.from({ length: 15 }, (_, index) => task(index));
    const first = selectTaskStatusTargets(tasks, {
      force: true,
      cursor: 0,
      now: Date.UTC(2026, 6, 28),
    });
    const second = selectTaskStatusTargets(tasks, {
      force: true,
      cursor: first.nextCursor,
      now: Date.UTC(2026, 6, 28),
    });

    expect(first.targets).toHaveLength(12);
    expect(second.targets.map((item) => item.id)).toEqual([
      "task-12",
      "task-13",
      "task-14",
      "task-00",
      "task-01",
      "task-02",
      "task-03",
      "task-04",
      "task-05",
      "task-06",
      "task-07",
      "task-08",
    ]);
  });

  it("limits normal refreshes to six stale tasks", () => {
    const selection = selectTaskStatusTargets(
      Array.from({ length: 10 }, (_, index) => task(index)),
      {
        force: false,
        now: Date.UTC(2026, 6, 28),
      },
    );

    expect(selection.targets).toHaveLength(6);
  });

  it("rechecks graded scores after seven days but not before", () => {
    const now = Date.UTC(2026, 6, 28);
    const selection = selectTaskStatusTargets([
      task(1, {
        status: "採点済み",
        statusUpdatedAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      task(2, {
        status: "採点済み",
        statusUpdatedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ], {
      force: false,
      now,
    });

    expect(selection.targets.map((item) => item.id)).toEqual(["task-02"]);
  });
});

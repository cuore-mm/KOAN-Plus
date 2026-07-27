import { describe, expect, it } from "vitest";
import { gradebookColumnsToTasks } from "./cle";

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

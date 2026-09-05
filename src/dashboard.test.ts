import { describe, expect, it } from "vitest";
import type { CleTask } from "./cle";
import type { KoanSurvey, Notice } from "./koan";
import { groupDeadlineActions, isUniversityImportant, noticeAttentionReason } from "./dashboard";

const task = (id: string, dueAt: string | null): CleTask => ({
  id, title: id, dueAt, courseId: "course", courseName: "授業", status: "未着手",
});
const survey = (title: string, endAt: string): KoanSurvey => ({
  title, endAt, courseName: "授業", slot: "", startAt: null, status: "回答受付中",
  responseStatus: "未回答", completed: false, kind: "course",
});
const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).toISOString();

describe("deadline order", () => {
  it("orders both sources by deadline and keeps undated work last", () => {
    const groups = groupDeadlineActions([
      task("来週", at(14)), task("未設定", null), task("午後", at(7, 15)), task("金曜", at(11)),
    ], [survey("来月", at(30)), survey("午前", at(7, 10))], new Date(2026, 8, 7, 9).getTime());
    expect(groups.map((g) => g.label)).toEqual(["今日", "今週", "それ以降", "期限未設定"]);
    expect(groups.flatMap((g) => g.actions.map((a) => a.kind === "task" ? a.task.title : a.survey.title)))
      .toEqual(["午前", "午後", "金曜", "来週", "来月", "未設定"]);
  });

  it("starts a new week on Monday, including midnight boundaries", () => {
    const groups = groupDeadlineActions([task("日曜", at(6, 23)), task("月曜", at(7, 0))], [], new Date(2026, 8, 6, 9).getTime());
    expect(groups.map((g) => [g.label, g.actions.length])).toEqual([["今日", 1], ["それ以降", 1]]);
  });

  it("does not let malformed dates disrupt the chronological order", () => {
    const groups = groupDeadlineActions([task("不明", "invalid"), task("午後", at(7, 15)), task("午前", at(7, 10))], [], new Date(2026, 8, 7, 9).getTime());
    expect(groups[0].actions.map((a) => a.kind === "task" && a.task.id)).toEqual(["午前", "午後"]);
    expect(groups[1].label).toBe("期限未設定");
  });
});

describe("notice provenance", () => {
  const notice: Notice = {
    title: "試験の日程変更について", priority: "", unread: true, href: "", genre: "教務",
    department: "", author: "", period: "", live: true,
  };
  it("never infers the university's importance flag from the title", () => {
    expect(isUniversityImportant(notice)).toBe(false);
    expect(noticeAttentionReason(notice)).toBe("未読・件名に「試験」を含む");
    expect(isUniversityImportant({ ...notice, priority: "○" })).toBe(true);
    expect(noticeAttentionReason({ ...notice, priority: "○" })).toContain("大学の重要指定");
  });
});

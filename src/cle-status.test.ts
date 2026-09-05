import { expect, it } from "vitest";
import { EMPTY_CLE_DATA } from "./cle";
import { cleCacheIssue, cleCollectionIssue } from "./cle-status";

it("restores partial message status from persisted evidence without flagging tasks", () => {
  const data = { ...EMPTY_CLE_DATA, messagesComplete: false, messagesPendingCount: 1, warnings: ["メッセージ: 次ページが前進しません"] };
  expect(cleCacheIssue(data)).toContain("次ページが前進しません");
  expect(cleCollectionIssue(data, "tasks", cleCacheIssue(data))).toBe("");
  expect(cleCollectionIssue(data, "messages", cleCacheIssue(data))).toContain("次ページが前進しません");
});

it("keeps authentication failures global and unknown warnings visible", () => {
  expect(cleCollectionIssue(EMPTY_CLE_DATA, "tasks", "セッション切れ")).toBe("セッション切れ");
  expect(cleCollectionIssue({ ...EMPTY_CLE_DATA, warnings: ["不明な取得失敗"] }, "tasks")).toBe("不明な取得失敗");
});

it("does not report success when only another CLE collection has loaded", () => {
  expect(cleCacheIssue({ ...EMPTY_CLE_DATA, updatedAt: new Date().toISOString() })).toContain("課題: 一覧はまだ確認できていません");
});

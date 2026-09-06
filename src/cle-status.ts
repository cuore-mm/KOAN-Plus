import type { CleData } from "./cle";

/** Use persisted resource evidence as well as the latest in-memory operation. */
export function cleCacheIssue(data: CleData) {
  const issues = [...(data.warnings || [])];
  const add = (prefix: string, message: string) => {
    if (!issues.some(issue => issue.startsWith(prefix))) issues.push(message);
  };
  if (data.messagesComplete === false || data.messagesPendingCount) add("メッセージ", "メッセージ: 続きの取得が必要です");
  if (data.taskStatusPendingCount) add("課題状態", `課題状態: 残り${data.taskStatusPendingCount}件`);
  if (data.announcementsPendingCount) add("連絡事項", `連絡事項: 残り${data.announcementsPendingCount}科目`);
  if (data.updatedAt && !data.tasksUpdatedAt) add("課題", "課題: 一覧はまだ確認できていません");
  return issues.length ? `一部未取得です: ${issues.join(" / ")}` : "";
}

/** A message pagination failure must not invalidate successfully fetched tasks. */
export function cleCollectionIssue(data: CleData, collection: "tasks" | "messages", operationIssue = "") {
  if (operationIssue && !operationIssue.startsWith("一部未取得です:")) return operationIssue;
  const relevant = collection === "tasks" ? /^(課題|CLEカレンダー|コース)/ : /^(メッセージ|連絡事項|コース)/;
  const issues = (data.warnings || []).filter(issue => relevant.test(issue));
  // Preserve unfamiliar failures (for example storage errors) in both views.
  issues.push(...(data.warnings || []).filter(issue => !/^(課題|CLEカレンダー|コース|メッセージ|連絡事項)/.test(issue)));
  if (collection === "tasks" && data.taskStatusPendingCount) issues.push("課題の提出状況を確認中です");
  if (collection === "messages" && (data.messagesComplete === false || data.messagesPendingCount || data.announcementsPendingCount)) issues.push("一部の連絡を確認中です");
  return [...new Set(issues)].join(" / ");
}

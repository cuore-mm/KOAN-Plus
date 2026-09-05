import type { CleTask } from "./cle";
import type { KoanSurvey, Notice } from "./koan";

export type DeadlineAction =
  | { kind: "task"; task: CleTask; dueAt: string | null }
  | { kind: "survey"; survey: KoanSurvey; dueAt: string };

/** One ordering across both sources; a source must never outrank a deadline. */
export function groupDeadlineActions(tasks: CleTask[], surveys: KoanSurvey[], now: number) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const nextWeek = new Date(tomorrow);
  const weekday = new Date(now).getDay();
  nextWeek.setDate(nextWeek.getDate() + (7 - weekday) % 7);
  const actions: DeadlineAction[] = [
    ...tasks.map((task): DeadlineAction => ({ kind: "task", task, dueAt: task.dueAt })),
    ...surveys.filter((survey) => survey.endAt).map((survey): DeadlineAction => ({
      kind: "survey", survey, dueAt: survey.endAt!,
    })),
  ];
  const timestamp = (action: DeadlineAction) => {
    const value = action.dueAt ? Date.parse(action.dueAt) : NaN;
    return Number.isFinite(value) ? value : Infinity;
  };
  const groups = ["今日", "今週", "それ以降", "期限未設定"].map((label) => ({ label, actions: [] as DeadlineAction[] }));
  for (const action of actions.sort((left, right) => timestamp(left) - timestamp(right))) {
    const at = timestamp(action);
    const index = !Number.isFinite(at) ? 3 : at < tomorrow.getTime() ? 0 : at < nextWeek.getTime() ? 1 : 2;
    groups[index].actions.push(action);
  }
  return groups.filter((group) => group.actions.length);
}

export function isUniversityImportant(notice: Notice) {
  return notice.priority === "○";
}

/** Explain the existing attention score without implying an official designation. */
export function noticeAttentionReason(notice: Notice) {
  const keyword = notice.title.match(/重要|要確認|締切|期限|停止|休講|変更|試験/)?.[0];
  const reasons = [
    notice.unread ? "未読" : "",
    notice.isNew ? "新着" : "",
    isUniversityImportant(notice) ? "大学の重要指定" : "",
    keyword ? `件名に「${keyword}」を含む` : "",
    notice.genre === "個別連絡" ? "個別連絡" : "",
  ];
  return reasons.filter(Boolean).join("・");
}

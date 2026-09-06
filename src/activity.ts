const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const RECENT_ACTIVITY_WINDOW_MS = 7 * DAY_MS;

const jstDayNumber = (timestamp: number) =>
  Math.floor((timestamp + JST_OFFSET_MS) / DAY_MS);

export function isRecentActivity(
  value: string,
  now = Date.now(),
  windowMs = RECENT_ACTIVITY_WINDOW_MS,
) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age < windowMs;
}

export function activityDateLabel(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const days = jstDayNumber(now) - jstDayNumber(timestamp);
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  if (days >= 2 && days < 7) return `${days}日前`;

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(timestamp));
}

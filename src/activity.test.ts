import { describe, expect, it } from "vitest";
import {
  RECENT_ACTIVITY_WINDOW_MS,
  activityDateLabel,
  isRecentActivity,
} from "./activity";

const NOW = new Date("2026-07-27T15:15:00.000Z").getTime(); // 7/28 00:15 JST

describe("activityDateLabel", () => {
  it("uses Japanese calendar days instead of elapsed 24-hour blocks", () => {
    expect(activityDateLabel("2026-07-27T14:45:00.000Z", NOW)).toBe("昨日");
    expect(activityDateLabel("2026-07-28T00:00:00.000Z", NOW)).toBe("今日");
  });

  it("uses relative labels for the rest of the recent activity window", () => {
    expect(activityDateLabel("2026-07-25T03:00:00.000Z", NOW)).toBe("3日前");
  });

  it("falls back to a calendar date and handles malformed values", () => {
    expect(activityDateLabel("2026-07-20T03:00:00.000Z", NOW)).toBe("7/20");
    expect(activityDateLabel("not-a-date", NOW)).toBe("");
  });
});

describe("isRecentActivity", () => {
  it("includes current and recent timestamps", () => {
    expect(isRecentActivity(new Date(NOW).toISOString(), NOW)).toBe(true);
    expect(isRecentActivity(new Date(NOW - RECENT_ACTIVITY_WINDOW_MS + 1).toISOString(), NOW))
      .toBe(true);
  });

  it("excludes future, expired, and malformed timestamps", () => {
    expect(isRecentActivity(new Date(NOW + 1).toISOString(), NOW)).toBe(false);
    expect(isRecentActivity(new Date(NOW - RECENT_ACTIVITY_WINDOW_MS).toISOString(), NOW))
      .toBe(false);
    expect(isRecentActivity("not-a-date", NOW)).toBe(false);
  });
});

import { expect, it } from "vitest";
import { communicationItems, homeCommunicationGroups, noticeTimestamp } from "./communications";
import type { Notice } from "./koan";

const notice: Notice = { title: "授業の連絡", href: "https://koan.osaka-u.ac.jp/notice?keijino=1", genre: "授業", priority: "", unread: false,
  department: "", author: "", period: "2026/09/05 ～ 2026/10/05", live: true };
const announcement = { id: "a", courseId: "c", courseName: "授業", title: "CLE連絡", body: "", created: "2026-09-06T09:00:00+09:00" };

it("merges sources chronologically without turning recent CLE announcements into unread items", () => {
  const items = communicationItems([notice], [announcement], []);
  expect(items.map(item => item.kind)).toEqual(["announcement", "notice"]);
  expect(items.map(item => item.unreadCount)).toEqual([0, 0]);
});

it("keeps known unread items first and retains messages whose timestamps are unavailable", () => {
  const items = communicationItems([{ ...notice, unread: true }], [announcement], [
    { courseId: "c", courseName: "授業", unreadCount: 2 },
    { courseId: "d", courseName: "既読", unreadCount: 0 },
  ]);
  expect(items.map(item => item.kind)).toEqual(["notice", "message", "announcement"]);
  expect(items.reduce((sum, item) => sum + item.unreadCount, 0)).toBe(3);
  expect(new Set(items.map(item => item.key)).size).toBe(3);
});

it("keeps undated records after dated records without dropping them", () => {
  const items = communicationItems([{ ...notice, period: "不明" }], [announcement], []);
  expect(items.map(item => item.kind)).toEqual(["announcement", "notice"]);
  expect(items[1].timestamp).toBe(0);
});

it("hundreds of old unread KOAN notices cannot displace CLE communications", () => {
  const old = Array.from({ length: 400 }, (_, i) => ({ ...notice, title: `募集のお知らせ ${i}`, href: `https://koan.osaka-u.ac.jp/notice?keijino=${i}`, unread: true, period: "2025/01/01" }));
  const latest = { ...notice, title: "大学の新しいお知らせ", period: "2026/09/07" };
  const related = { ...notice, title: "基礎神経科学の資料について", unread: true };
  const messages = [{ courseId: "c", courseName: "基礎神経科学", unreadCount: 2 }];
  const groups = homeCommunicationGroups([...old, latest, related], [announcement], messages);
  expect(groups.messages[0]).toMatchObject({ kind: "message", unreadCount: 2, timestamp: 0 });
  expect(groups.cle.map(item => item.kind)).toEqual(["announcement"]);
  expect(groups.koan[0]).toMatchObject({ notice: latest });
  expect(groups.koan).toHaveLength(402);
  expect(groups.koan[1]).toMatchObject({ notice: related });
});

it("source grouping retains undated notices and does not infer CLE read state", () => {
  const undated = { ...notice, period: "不明" };
  const groups = homeCommunicationGroups([undated, notice], [announcement], []);
  expect(groups.koan.map(item => item.timestamp)).toEqual([noticeTimestamp(notice), 0]);
  expect(groups.cle[0]).toMatchObject({ kind: "announcement", unreadCount: 0 });
  expect(groups.messages).toEqual([]);
});

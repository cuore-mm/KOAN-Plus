import type { CleAnnouncement, CleData } from "./cle";
import { noticeKey, type Notice } from "./koan";

export type CommunicationItem = (
  | { kind: "notice"; notice: Notice }
  | { kind: "announcement"; announcement: CleAnnouncement }
  | { kind: "message"; message: CleData["messages"][number] }
) & { key: string; unreadCount: number; timestamp: number };

export function noticeTimestamp(notice: Notice) {
  const match = notice.period.match(/(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/);
  if (!match) return 0;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

/** Source labels never determine priority. Message timestamps are unavailable. */
export function communicationItems(
  notices: Notice[], announcements: CleAnnouncement[], messages: CleData["messages"],
): CommunicationItem[] {
  const items: CommunicationItem[] = [
    ...notices.map((notice): CommunicationItem => ({ kind: "notice", notice,
      key: `koan:${noticeKey(notice)}`, unreadCount: notice.unread ? 1 : 0, timestamp: noticeTimestamp(notice) })),
    ...announcements.map((announcement): CommunicationItem => ({ kind: "announcement", announcement,
      key: `cle:${announcement.courseId}:${announcement.id}`, unreadCount: 0, timestamp: Date.parse(announcement.created) || 0 })),
    ...messages.filter((message) => message.unreadCount > 0).map((message): CommunicationItem => ({ kind: "message", message,
      key: `message:${message.courseId}`, unreadCount: message.unreadCount, timestamp: 0 })),
  ];
  return items.sort((a, b) => Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || b.timestamp - a.timestamp);
}

/** Independent source previews keep CLE visible regardless of the number of KOAN notices. */
export function homeCommunicationGroups(
  notices: Notice[], announcements: CleAnnouncement[], messages: CleData["messages"],
) {
  const groups = { messages: [] as CommunicationItem[], cle: [] as CommunicationItem[], koan: [] as CommunicationItem[] };
  for (const item of communicationItems(notices, announcements, messages)) {
    if (item.kind === "message") groups.messages.push(item);
    else if (item.kind === "announcement") groups.cle.push(item);
    else groups.koan.push(item);
  }
  // Known unread messages remain separate because they have no timestamp.
  groups.cle.sort((a, b) => b.timestamp - a.timestamp);
  groups.koan.sort((a, b) => b.timestamp - a.timestamp);
  return groups;
}

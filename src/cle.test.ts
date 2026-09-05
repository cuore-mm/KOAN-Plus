import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CLE_DATA,
  fetchAllResults,
  fetchMessages,
  getCachedCourseMaterials,
  gradebookColumnsToTasks,
  isCleCacheFresh,
  isMaterialCacheFresh,
  MATERIALS_CACHE_MAX_AGE_MS,
  MATERIALS_CACHE_MAX_COURSES,
  persistMaterialCache,
  retainMaterialCache,
  refreshCle,
  resolveActiveCleCourses,
  resolveTaskStatus,
  resolveTaskStatusEvidence,
  selectTaskStatusTargets,
  withMaterialCacheWarnings,
  type CleCourse,
  type CleTask,
} from "./cle";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

function stubUnavailableLocalStorage() {
  const blocked = () => {
    throw Object.assign(new Error("localStorage is blocked"), { name: "SecurityError" });
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });
}

function emptyRefreshResponse() {
  return {
    ok: true,
    response: {
      ok: true,
      status: 200,
      text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
    },
  };
}

function stubEmptyRefreshChrome(options: {
  budgetMessages?: boolean;
  rateLimitMessages?: boolean;
} = {}) {
  vi.stubGlobal("window", globalThis);
  const sendMessage = vi.fn(async (message: any) => {
    const url = new URL(message.request.url);
    if (
      url.pathname.includes("/users/me/courses") ||
      url.pathname.includes("/calendars/items")
    ) {
      return emptyRefreshResponse();
    }
    if (!options.budgetMessages) return emptyRefreshResponse();
    const offset = Number(url.searchParams.get("offset") || 0);
    if (options.rateLimitMessages && offset >= 100) {
      return {
        ok: true,
        response: {
          ok: false,
          status: 429,
          retryAfterMs: 1,
          text: "",
        },
      };
    }
    return {
      ok: true,
      response: {
        ok: true,
        status: 200,
        text: JSON.stringify({
          results: [{ courseId: `course-${offset}`, courseName: "科目", numUnreadMessages: 1 }],
          paging: {
            nextPage: `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`,
          },
        }),
      },
    };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  return sendMessage;
}

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

  it("retries a rate-limited page and then continues", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    let calls = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true,
              response: {
                ok: false,
                status: 429,
                retryAfterMs: 1,
                text: "",
              },
            };
          }
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({ results: [{ id: "ok" }], paging: {} }),
            },
          };
        }),
      },
    });

    const request = fetchAllResults(
      "https://www.cle.osaka-u.ac.jp/learn/api/public/v1/example?limit=2",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(request).resolves.toMatchObject([{ id: "ok" }]);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("deduplicates records repeated across adjacent pages", async () => {
    vi.stubGlobal("window", globalThis);
    let page = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => {
          page += 1;
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify(page === 1
                ? {
                  results: [{ id: "one" }],
                  paging: { nextPage: "/learn/api/v1/example?offset=1&limit=2" },
                }
                : { results: [{ id: "one" }, { id: "two" }], paging: { nextPage: "" } }),
            },
          };
        }),
      },
    });

    await expect(fetchAllResults(
      "https://www.cle.osaka-u.ac.jp/learn/api/v1/example?offset=0&limit=2",
    )).resolves.toEqual([{ id: "one" }, { id: "two" }]);
  });
});

describe("fetchMessages", () => {
  it("recovers once from a self-loop using the received page size", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const url = new URL(message.request.url);
          const offset = Number(url.searchParams.get("offset"));
          offsets.push(offset);
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: offset === 2
                  ? []
                  : [{ courseId: `course-${offset}`, numUnreadMessages: 1 }],
                paging: {
                  nextPage: offset === 0
                    ? "/learn/api/v1/messages/summary?offset=0&limit=100"
                    : offset === 1
                      ? "/learn/api/v1/messages/summary?offset=2&limit=100"
                      : "",
                },
              }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages();

    expect(offsets).toEqual([0, 1, 2]);
    expect(result.complete).toBe(true);
    expect(result.nextPage).toBeNull();
    expect(result.messages.map((message) => message.courseId)).toEqual(["course-0", "course-1"]);
  });

  it("treats an explicitly empty recovery page as an authoritative end", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          offsets.push(offset);
          const payload = offset === 0
            ? {
              results: [{ courseId: "course-0", numUnreadMessages: 1 }],
              paging: { nextPage: "/learn/api/v1/messages/summary?offset=0&limit=100" },
            }
            : { results: [], paging: { nextPage: null } };
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify(payload),
            },
          };
        }),
      },
    });

    const result = await fetchMessages(undefined, [{
      courseId: "old-course",
      courseName: "以前の科目",
      unreadCount: 2,
    }]);

    expect(offsets).toEqual([0, 1]);
    expect(result.complete).toBe(true);
    expect(result.nextPage).toBeNull();
    expect(result.warning).toBeUndefined();
    expect(result.messages).toEqual([{
      courseId: "course-0",
      courseName: "CLE科目",
      unreadCount: 1,
    }]);
  });

  it("preserves cached messages when an empty recovery page has malformed paging", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          offsets.push(offset);
          const payload = offset === 0
            ? {
              results: [{ courseId: "course-0", numUnreadMessages: 1 }],
              paging: { nextPage: "/learn/api/v1/messages/summary?offset=0&limit=100" },
            }
            : { results: [], paging: { nextPage: {} } };
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify(payload),
            },
          };
        }),
      },
    });

    const result = await fetchMessages(undefined, [{
      courseId: "old-course",
      courseName: "以前の科目",
      unreadCount: 2,
    }]);

    expect(offsets).toEqual([0, 1]);
    expect(result.complete).toBe(false);
    expect(result.nextPage).toBeNull();
    expect(result.warning).toContain("次ページ情報が不正");
    expect(result.messages.map((message) => message.courseId)).toEqual(["old-course", "course-0"]);
  });

  it("stops an unrecoverable repeated page after one recovery request", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          offsets.push(offset);
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{ courseId: "same-course", courseName: "科目", numUnreadMessages: 1 }],
                paging: { nextPage: "/learn/api/v1/messages/summary?offset=0&limit=100" },
              }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages(undefined, [{
      courseId: "cached-course",
      courseName: "保存済み科目",
      unreadCount: 2,
    }]);

    expect(offsets).toEqual([0, 1]);
    expect(result.complete).toBe(false);
    expect(result.nextPage).toBeNull();
    expect(result.warning).toContain("同じ内容");
    expect(result.messages).toEqual([
      { courseId: "cached-course", courseName: "保存済み科目", unreadCount: 2 },
      { courseId: "same-course", courseName: "科目", unreadCount: 1 },
    ]);
  });

  it("returns a partial result at the server-side page cap", async () => {
    vi.stubGlobal("window", globalThis);
    const sendMessage = vi.fn(async (message: any) => {
      const offset = Number(new URL(message.request.url).searchParams.get("offset"));
      return {
        ok: true,
        response: {
          ok: true,
          status: 200,
          text: JSON.stringify({
            results: [{
              courseId: `course-${offset}`,
              courseName: "科目",
              numUnreadMessages: 1,
            }],
            paging: {
              nextPage: `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`,
            },
          }),
        },
      };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    const result = await fetchMessages();

    expect(result.complete).toBe(false);
    expect(result.warning).toContain("上限");
    expect(result.messages).toHaveLength(8);
    expect(new URL(result.nextPage || "").searchParams.get("offset")).toBe("800");
    expect(sendMessage).toHaveBeenCalledTimes(8);
  });

  it("does not persist a guessed recovery cursor when the budget ends", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          offsets.push(offset);
          const nextPage = offset < 7
            ? `/learn/api/v1/messages/summary?offset=${offset + 1}&limit=100`
            : "/learn/api/v1/messages/summary?offset=7&limit=100";
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{
                  courseId: `course-${offset}`,
                  courseName: "科目",
                  numUnreadMessages: 1,
                }],
                paging: { nextPage },
              }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages();

    expect(offsets).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.complete).toBe(false);
    expect(result.reason).toBe("budget");
    expect(result.nextPage).toBeNull();
    expect(result.warning).toContain("上限");
  });

  it("rechecks the head and resumes the deep cursor on the next run", async () => {
    vi.stubGlobal("window", globalThis);
    const offsets: number[] = [];
    let headVisits = 0;
    const sendMessage = vi.fn(async (message: any) => {
      const url = new URL(message.request.url);
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      const isHead = offset === 0;
      const courseId = isHead && headVisits++ > 0
        ? "new-head"
        : `course-${offset}`;
      return {
        ok: true,
        response: {
          ok: true,
          status: 200,
          text: JSON.stringify({
            results: [{ courseId, courseName: "科目", numUnreadMessages: 1 }],
            paging: {
              nextPage: `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`,
            },
          }),
        },
      };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    const first = await fetchMessages();
    const second = await fetchMessages(undefined, first.messages, undefined, first.nextPage);

    expect(offsets.slice(0, 8)).toEqual([0, 100, 200, 300, 400, 500, 600, 700]);
    expect(offsets.slice(8)).toEqual([0, 800, 900, 1000, 1100, 1200, 1300, 1400]);
    expect(second.messages.map((message) => message.courseId)).toContain("new-head");
    expect(second.messages.map((message) => message.courseId)).toContain("course-800");
    expect(new URL(second.nextPage || "").searchParams.get("offset")).toBe("1500");
    expect(second.complete).toBe(false);
    expect(second.pendingCount).toBe(1);
  });

  it("keeps the previous middle pages when a resumed scan finishes", async () => {
    vi.stubGlobal("window", globalThis);
    let run = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          if (offset === 0) {
            run += 1;
          }
          const isFirstRun = run === 1;
          const isHead = offset === 0;
          const item = isFirstRun
            ? { courseId: `course-${offset}`, numUnreadMessages: 1 }
            : isHead
              ? { courseId: "course-0", numUnreadMessages: 0 }
              : { courseId: `course-${offset}`, numUnreadMessages: 1 };
          const nextPage = isFirstRun
            ? `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`
            : offset === 800
              ? ""
              : `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`;
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({ results: [item], paging: { nextPage } }),
            },
          };
        }),
      },
    });

    const first = await fetchMessages();
    expect(first.complete).toBe(false);
    const second = await fetchMessages(undefined, first.messages, undefined, first.nextPage);
    const ids = second.messages.map((message) => message.courseId);

    expect(second.complete).toBe(true);
    expect(second.nextPage).toBeNull();
    expect(ids).toEqual([
      "course-100",
      "course-200",
      "course-300",
      "course-400",
      "course-500",
      "course-600",
      "course-700",
      "course-800",
    ]);
    expect(second.messages.find((message) => message.courseId === "course-0")).toBeUndefined();
  });

  it("resets the cursor after a complete scan", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const offset = Number(new URL(message.request.url).searchParams.get("offset"));
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{ courseId: `course-${offset}`, numUnreadMessages: 1 }],
                paging: offset === 0
                  ? { nextPage: "/learn/api/v1/messages/summary?offset=100&limit=100" }
                  : { nextPage: "" },
              }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages();

    expect(result.complete).toBe(true);
    expect(result.pendingCount).toBe(0);
    expect(result.nextPage).toBeNull();
  });

  it("does not record failure backoff for a normal budget continuation", async () => {
    const values = stubLocalStorage();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const url = new URL(message.request.url);
          if (url.pathname.includes("/users/me/courses")) {
            return {
              ok: true,
              response: {
                ok: true,
                status: 200,
                text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
              },
            };
          }
          if (url.pathname.includes("/calendars/items")) {
            return {
              ok: true,
              response: {
                ok: true,
                status: 200,
                text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
              },
            };
          }
          const offset = Number(url.searchParams.get("offset"));
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{ courseId: `course-${offset}`, numUnreadMessages: 1 }],
                paging: {
                  nextPage: `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100`,
                },
              }),
            },
          };
        }),
      },
    });

    const result = await refreshCle(undefined, undefined, undefined, true);

    expect(result.messagesComplete).toBe(false);
    expect(result.messagesPendingCount).toBe(1);
    expect(result.messagesNextPage).toContain("offset=800");
    expect(result.warnings?.some((warning) => warning.includes("次回は続き"))).toBe(true);
    expect(values.get("koan-plus-cle-messages-failure-v1")).toBeUndefined();
  });

  it("records Retry-After backoff for a rate-limited continuation", async () => {
    const values = stubLocalStorage();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const url = new URL(message.request.url);
          if (url.pathname.includes("/users/me/courses")) {
            return {
              ok: true,
              response: {
                ok: true,
                status: 200,
                text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
              },
            };
          }
          if (url.pathname.includes("/calendars/items")) {
            return {
              ok: true,
              response: {
                ok: true,
                status: 200,
                text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
              },
            };
          }
          const offset = Number(url.searchParams.get("offset"));
          if (offset >= 100) {
            return {
              ok: true,
              response: {
                ok: false,
                status: 429,
                retryAfter: "0.001",
                text: "",
              },
            };
          }
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{ courseId: "course-0", numUnreadMessages: 1 }],
                paging: {
                  nextPage: "/learn/api/v1/messages/summary?offset=100&limit=100",
                },
              }),
            },
          };
        }),
      },
    });

    const result = await refreshCle(undefined, undefined, undefined, true);
    const failure = JSON.parse(values.get("koan-plus-cle-messages-failure-v1") || "{}");

    expect(result.messagesComplete).toBe(false);
    expect(result.messagesNextPage).toContain("offset=100");
    expect(result.warnings?.some((warning) => warning.includes("途中取得"))).toBe(true);
    expect(failure.nextRetryAt).toBeGreaterThan(Date.now() + 50 * 1000);
  });

  it("continues a complete refresh when coordination storage is unavailable", async () => {
    stubUnavailableLocalStorage();
    stubEmptyRefreshChrome();

    await expect(refreshCle(undefined, undefined, undefined, true)).resolves.toMatchObject({
      messagesComplete: true,
      messagesPendingCount: 0,
    });
  });

  it("keeps a message partial result when coordination storage is unavailable", async () => {
    stubUnavailableLocalStorage();
    stubEmptyRefreshChrome({ budgetMessages: true });

    const result = await refreshCle(undefined, undefined, undefined, true);

    expect(result.messagesComplete).toBe(false);
    expect(result.messagesPendingCount).toBe(1);
    expect(result.messagesNextPage).toContain("offset=800");
    expect(result.warnings?.some((warning) => warning.includes("次回は続き"))).toBe(true);
  });

  it("keeps an error partial result when failure backoff cannot be persisted", async () => {
    stubUnavailableLocalStorage();
    stubEmptyRefreshChrome({ budgetMessages: true, rateLimitMessages: true });

    const result = await refreshCle(undefined, undefined, undefined, true);

    expect(result.messagesComplete).toBe(false);
    expect(result.messagesPendingCount).toBe(1);
    expect(result.messages).toEqual([{
      courseId: "course-0",
      courseName: "科目",
      unreadCount: 1,
    }]);
    expect(result.warnings?.some((warning) => warning.includes("途中取得"))).toBe(true);
  });

  it("does not release a newer owner lease after the original refresh finishes", async () => {
    const values = stubLocalStorage();
    vi.stubGlobal("window", globalThis);
    let releaseFirstRequest = () => {};
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let holdFirstRequest = true;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          if (holdFirstRequest) {
            holdFirstRequest = false;
            await firstRequest;
          }
          return emptyRefreshResponse();
        }),
      },
    });

    const refresh = refreshCle(undefined, undefined, undefined, true);
    expect(values.get("koan-plus-cle-refresh-lease-v1")).toBeTruthy();
    values.set("koan-plus-cle-refresh-lease-v1", "new-owner");
    releaseFirstRequest();

    await refresh;

    expect(values.get("koan-plus-cle-refresh-lease-v1")).toBe("new-owner");
  });

  it("rejects an unsafe cursor without requesting it", async () => {
    vi.stubGlobal("window", globalThis);
    const requested: string[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          requested.push(message.request.url);
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages(
      undefined,
      [],
      undefined,
      "https://example.invalid/steal?offset=800&limit=100",
    );

    expect(result.warning).toContain("カーソルが不正");
    expect(result.nextPage).toBeNull();
    expect(requested).toHaveLength(1);
    expect(new URL(requested[0]).origin).toBe("https://www.cle.osaka-u.ac.jp");
  });

  it("rejects cursors with non-digit offset values", async () => {
    vi.stubGlobal("window", globalThis);
    const requested: string[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          requested.push(message.request.url);
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({ results: [], paging: { nextPage: "" } }),
            },
          };
        }),
      },
    });

    const result = await fetchMessages(
      undefined,
      [],
      undefined,
      "https://www.cle.osaka-u.ac.jp/learn/api/v1/messages/summary?offset=12junk&limit=100",
    );

    expect(result.warning).toContain("カーソルが不正");
    expect(requested).toHaveLength(1);
    expect(new URL(requested[0]).searchParams.get("offset")).toBe("0");
  });

  it("clears old messages on a valid empty response without paging metadata", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          response: {
            ok: true,
            status: 200,
            text: JSON.stringify({ results: [] }),
          },
        })),
      },
    });

    const result = await fetchMessages(undefined, [{
      courseId: "old-course",
      courseName: "以前の科目",
      unreadCount: 2,
    }]);

    expect(result.complete).toBe(true);
    expect(result.nextPage).toBeNull();
    expect(result.messages).toEqual([]);
  });

  it("keeps prior tasks when the calendar response is malformed", async () => {
    vi.stubGlobal("window", globalThis);
    const previousTask: CleTask = {
      id: "old-task",
      courseId: "course-1",
      courseName: "以前の科目",
      title: "以前の課題",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "状態不明",
    };
    const sendMessage = vi.fn(async (message: any) => {
      const url = new URL(message.request.url);
      let payload: any = { results: [] };
      if (url.pathname.includes("/users/me/courses")) {
        payload = {
          results: [{
            courseId: "course-1",
            course: {
              id: "course-1",
              courseId: "2026-01-ABC001-科目",
              name: "科目",
            },
          }],
          paging: { nextPage: "" },
        };
      } else if (url.pathname.includes("/calendars/items")) {
        return {
          ok: true,
          response: { ok: true, status: 200, text: JSON.stringify({ unexpected: [] }) },
        };
      } else if (url.pathname.includes("/gradebook/columns")) {
        payload = { results: [], paging: { nextPage: "" } };
      }
      return {
        ok: true,
        response: { ok: true, status: 200, text: JSON.stringify(payload) },
      };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    const result = await refreshCle({
      ...EMPTY_CLE_DATA,
      courses: [],
      tasks: [previousTask],
    }, undefined, undefined, true);

    expect(result.tasks).toEqual(expect.arrayContaining([expect.objectContaining({
      id: previousTask.id,
      courseId: previousTask.courseId,
      title: previousTask.title,
    })]));
    expect(result.warnings).toContain("CLEカレンダーを取得できなかったため、以前の課題を保持しました");
    expect(sendMessage.mock.calls.some(([message]) =>
      String(message.request.url).includes("/calendars/items"),
    )).toBe(true);
  });

  it("accepts a qualified empty calendar and gradebook response as authoritative", async () => {
    vi.stubGlobal("window", globalThis);
    const previousTask: CleTask = {
      id: "old-task-qualified",
      courseId: "course-qualified",
      courseName: "科目",
      title: "古い課題",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "状態不明",
    };
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          const url = new URL(message.request.url);
          let payload: any = { results: [], paging: { nextPage: "" } };
          if (url.pathname.includes("/users/me/courses")) {
            payload = {
              results: [{
                courseId: "course-qualified",
                course: {
                  id: "course-qualified",
                  courseId: "2026-01-ABC002-科目",
                  name: "科目",
                },
              }],
              paging: { nextPage: "" },
            };
          }
          return {
            ok: true,
            response: { ok: true, status: 200, text: JSON.stringify(payload) },
          };
        }),
      },
    });

    const result = await refreshCle({
      ...EMPTY_CLE_DATA,
      tasks: [previousTask],
    }, undefined, undefined, true);

    expect(result.tasks).toEqual([]);
    expect(result.warnings).not.toContain("CLEカレンダーが空応答だったため、以前の課題を保持しました");
  });

  it("does not turn an authentication response into a partial success", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          response: { ok: false, status: 401, text: "" },
        })),
      },
    });

    await expect(fetchMessages(undefined, [{
      courseId: "old-course",
      courseName: "以前の科目",
      unreadCount: 1,
    }])).rejects.toThrow("401");
  });

  it("applies zero unread counts for courses seen before a partial failure", async () => {
    vi.stubGlobal("window", globalThis);
    let calls = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true,
              response: {
                ok: true,
                status: 200,
                text: JSON.stringify({
                  results: [{ courseId: "old-course", numUnreadMessages: 0 }],
                  paging: { nextPage: "/learn/api/v1/messages/summary?offset=100&limit=100" },
                }),
              },
            };
          }
          return {
            ok: true,
            response: { ok: false, status: 503, text: "" },
          };
        }),
      },
    });

    const result = await fetchMessages(undefined, [{
      courseId: "old-course",
      courseName: "以前の科目",
      unreadCount: 2,
    }]);

    expect(result.complete).toBe(false);
    expect(result.messages).toEqual([]);
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
      announcementsUpdatedAt: now,
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
    expect(isCleCacheFresh({
      ...base,
      announcementsUpdatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      announcementsPendingCount: 0,
      taskStatusPendingCount: 0,
    })).toBe(false);
    expect(isCleCacheFresh({
      ...base,
      messagesComplete: false,
      messagesPendingCount: 1,
      announcementsPendingCount: 0,
      taskStatusPendingCount: 0,
    })).toBe(false);
  });
});

describe("material cache", () => {
  function material(id: string) {
    return {
      id,
      contentId: `${id}-content`,
      attachmentId: `${id}-attachment`,
      title: id,
      fileName: `${id}.pdf`,
      mimeType: "application/pdf",
      size: 1,
      addedAt: new Date().toISOString(),
      folderPath: [],
      downloadUrl: `https://www.cle.osaka-u.ac.jp/ultra/download/${id}`,
    };
  }

  function materialList(courseId: string, updatedAt = new Date().toISOString()) {
    return {
      courseId,
      materials: [material(`${courseId}-material`)],
      updatedAt,
      complete: true,
      warnings: [],
    };
  }

  it("returns an old list so the UI can show it while refreshing", () => {
    const values = stubLocalStorage();
    const cached = {
      courseId: "course-1",
      materials: [],
      updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      complete: true,
    };
    values.set("koan-plus-cle-materials-v14", JSON.stringify({ "course-1": cached }));

    expect(getCachedCourseMaterials("course-1")).toEqual(cached);
    expect(isMaterialCacheFresh(cached)).toBe(false);
  });

  it("does not force-refresh a recent partial list on every open", () => {
    const cached = {
      courseId: "course-1",
      materials: [],
      updatedAt: new Date().toISOString(),
      complete: false,
      warnings: ["資料フォルダ: 取得失敗"],
    };

    expect(isMaterialCacheFresh(cached)).toBe(true);
  });

  it("drops malformed and old course entries while retaining the course being refreshed", () => {
    const oldDate = new Date(Date.now() - MATERIALS_CACHE_MAX_AGE_MS - 1).toISOString();
    const cache = {
      malformed: { courseId: "malformed", updatedAt: "not-a-date", materials: [] },
      old: materialList("old", oldDate),
      current: materialList("current", oldDate),
      recent: materialList("recent"),
    };

    const retained = retainMaterialCache(cache, "current");

    expect(retained.malformed).toBeUndefined();
    expect(retained.old).toBeUndefined();
    expect(retained.current).toBeDefined();
    expect(retained.recent).toBeDefined();
  });

  it("keeps only the newest course lists up to the retention limit", () => {
    const cache = Object.fromEntries(Array.from(
      { length: MATERIALS_CACHE_MAX_COURSES + 3 },
      (_, index) => [
        `course-${index}`,
        materialList(`course-${index}`, new Date(Date.now() - index * 1000).toISOString()),
      ],
    ));

    const retained = retainMaterialCache(cache);

    expect(Object.keys(retained)).toHaveLength(MATERIALS_CACHE_MAX_COURSES);
    expect(retained["course-0"]).toBeDefined();
    expect(retained[`course-${MATERIALS_CACHE_MAX_COURSES + 2}`]).toBeUndefined();
  });

  it("retries a quota failure with fewer courses and exposes a warning", () => {
    const values = new Map<string, string>();
    let writes = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => {
        writes += 1;
        if (writes === 1) {
          throw Object.assign(new Error("storage full"), { name: "QuotaExceededError" });
        }
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    });
    const warnings: string[] = [];
    const cache = Object.fromEntries(Array.from(
      { length: MATERIALS_CACHE_MAX_COURSES },
      (_, index) => [`course-${index}`, materialList(`course-${index}`)],
    ));

    persistMaterialCache(cache, "course-0", warnings);

    expect(writes).toBe(2);
    expect(values.has("koan-plus-cle-materials-v14")).toBe(true);
    expect(warnings.join(" ")).toContain("容量上限");
    expect(withMaterialCacheWarnings(materialList("course-0"), warnings).complete).toBe(false);
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

  it("skips long-expired tasks while retaining recent and submitted work", () => {
    const now = Date.UTC(2026, 6, 28);
    const selection = selectTaskStatusTargets([
      task(1, {
        dueAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
        status: "期限切れ",
      }),
      task(2, {
        dueAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      task(3, {
        dueAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
        status: "提出済み",
      }),
    ], {
      force: false,
      now,
    });

    expect(selection.targets.map((item) => item.id)).toEqual([
      "task-02",
      "task-03",
    ]);
  });
});


it("allows the post-reauthentication retry without discarding category caches", async () => {
  const values = stubLocalStorage();
  const sendMessage = stubEmptyRefreshChrome();
  values.set("koan-plus-cle-refresh-attempt-v1", String(Date.now()));
  values.set("koan-plus-cle-refresh-failure-v1", JSON.stringify({ count: 1, nextRetryAt: Date.now() + 60_000 }));
  const result = await refreshCle(EMPTY_CLE_DATA, 1, undefined, false, { bypassBackoff: true });
  expect(result.updatedAt).not.toBeNull();
  expect(sendMessage).toHaveBeenCalled();
});

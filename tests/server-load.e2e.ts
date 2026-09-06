import { expect, test, type Page } from "@playwright/test";

async function fixturePage(page: Page) {
  // Import the real scraper in a blank local page, without starting App sync.
  // Block all external traffic even if a fixture accidentally misses a URL.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/load-fixture") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>合成データ検証</title>" });
    return route.continue();
  });
  await page.goto("/load-fixture");
}

type Scenario = "page-cap" | "terminal" | "cycle" | "deadline" | "network-error" | "malformed" | "genre-error";

async function crawl(page: Page, scenario: Scenario) {
  await fixturePage(page);
  return page.evaluate(async scenario => {
    const modulePath = "/src/koan.ts";
    const koan = await import(modulePath);
    let now = Date.now();
    const stamp = new Date(now).toISOString();
    Date.now = () => now;
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, milliseconds?: number, ...args: unknown[]) => {
      if (milliseconds === 750) {
        now += 750;
        return realSetTimeout(callback, 0, ...args);
      }
      return realSetTimeout(callback, milliseconds, ...args);
    }) as typeof window.setTimeout;
    const origin = "https://koan.osaka-u.ac.jp/campusweb/";
    const root = koan.GENRES.map((genre: string, index: number) => `<a href="${origin}load-fixture?genre=${index}&page=1">${genre}</a>`).join("");
    const row = (index: number) => `<table><tr><th>ジャンル</th><th>表題</th><th>重要度</th><th>掲示期間</th></tr><tr><td>授業</td><td><a href="${origin}load-notice?keijitype=1&genrecd=fixture&seqNo=fixture-${index}">合成掲示${index}</a></td><td></td><td>合成期間</td></tr></table>`;
    const requests: string[] = [];
    window.fetch = (async (raw: RequestInfo | URL) => {
      const url = String(raw);
      requests.push(url);
      const query = new URL(url).searchParams;
      const index = Number(query.get("page") || 0);
      if (scenario === "genre-error" && query.get("genre") === "1") throw new Error("synthetic next genre failure");
      if (scenario === "network-error" && index === 2) throw new Error("synthetic network failure");
      if (scenario === "deadline" && index) now += 90_000;
      const next = (scenario === "terminal" && index === 100) || scenario === "genre-error" ? ""
        : `<a href="${origin}load-fixture?genre=0&page=${scenario === "cycle" ? 1 : index + 1}">次へ &gt;&gt;</a>`;
      const text = !index ? root : scenario === "malformed" && index === 2 ? "<p>unexpected page</p>" : row(index) + next;
      return { ok: true, status: 200, url, text: async () => text } as Response;
    }) as typeof window.fetch;
    const previous = {
      schedule: [], courses: [], changes: [], surveys: [],
      notices: ["page-cap", "terminal"].includes(scenario)
        ? Array.from({ length: 100 }, (_, index) => koan.parseNotices(new DOMParser().parseFromString(row(index + 1), "text/html"), origin)[0]) : [],
      snapshotComplete: false, snapshotUpdatedAt: null,
      snapshotGenreSyncAt: Object.fromEntries(koan.GENRES.slice(scenario === "genre-error" ? 2 : 1).map((genre: string) => [genre, stamp])),
      snapshotGenreVersions: Object.fromEntries(koan.GENRES.slice(scenario === "genre-error" ? 2 : 1).map((genre: string) => [genre, 2])),
    };
    const result = await koan.refreshSnapshot(previous);
    return {
      requestCount: requests.length,
      lastPage: new URL(requests[requests.length - 1]).searchParams.get("page"),
      count: result.notices.length,
      complete: result.snapshotComplete,
      warnings: result.warnings,
      snapshotUpdatedAt: result.snapshotUpdatedAt,
      failed: Boolean(localStorage.getItem("koan-plus-snapshot-failure-v1")),
      firstGenreComplete: result.snapshotGenreVersions[koan.GENRES[0]] === 2,
    };
  }, scenario);
}

test("a 100-page incomplete genre does not fetch an unconsumed page 101", async ({ page }) => {
  const result = await crawl(page, "page-cap");
  expect(result).toMatchObject({ requestCount: 101, lastPage: "100", count: 100, complete: false, snapshotUpdatedAt: null, failed: false });
  expect(result.warnings.join()).toContain("100ページ");
});

test("a terminal page at the traversal cap still completes the snapshot", async ({ page }) => {
  expect(await crawl(page, "terminal")).toMatchObject({ requestCount: 101, count: 100, complete: true, failed: false, warnings: [] });
});

test("cyclic pagination remains bounded and keeps the fetched notice", async ({ page }) => {
  const result = await crawl(page, "cycle");
  expect(result).toMatchObject({ requestCount: 3, count: 1, complete: false, failed: true });
  expect(result.warnings.join()).toContain("循環");
});

test("failure in a later genre preserves completed genres so a retry can skip them", async ({ page }) => {
  const result = await crawl(page, "genre-error");
  expect(result).toMatchObject({ requestCount: 3, count: 1, complete: false, failed: true, firstGenreComplete: true });
  expect(result.warnings.join()).toContain("synthetic next genre failure");
});

test("a deadline retains pages already fetched without requesting another page", async ({ page }) => {
  const result = await crawl(page, "deadline");
  expect(result).toMatchObject({ requestCount: 3, count: 2, complete: false, snapshotUpdatedAt: null, failed: false });
  expect(result.warnings.join()).toContain("制限時間");
});

for (const scenario of ["network-error", "malformed"] as const) {
  test(`${scenario} retains earlier pages and records a failure without further requests`, async ({ page }) => {
    const result = await crawl(page, scenario);
    expect(result).toMatchObject({ requestCount: 3, count: 1, complete: false, snapshotUpdatedAt: null, failed: true });
    expect(result.warnings).toHaveLength(1);
  });
}

test("an incomplete four-month schedule does not submit an unused fifth page", async ({ page }) => {
  await fixturePage(page);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/koan.ts";
    const koan = await import(modulePath);
    const stamp = new Date().toISOString();
    const old = [{ date: "2026-09-05", period: "1限", title: "保存済み合成科目", room: "" }];
    const methods: string[] = [];
    window.fetch = (async (raw: RequestInfo | URL, options?: RequestInit) => {
      methods.push(options?.method || "GET");
      return { ok: true, url: String(raw), text: async () => '<table id="schedule-calender"><tbody><tr><td><div class="cal-head-img"><a onclick="addSchedule(20200101)"></a></div></td></tr></tbody></table><form id="ScheduleListForm"><input name="_flowExecutionKey" value="synthetic-flow"></form>' } as Response;
    }) as typeof window.fetch;
    const result = await koan.refreshLight({
      schedule: old, courses: [], changes: [], surveys: [], notices: [],
      scheduleUpdatedAt: null, futureScheduleUpdatedAt: null,
      coursesUpdatedAt: stamp, changesUpdatedAt: stamp, futureChangesUpdatedAt: stamp,
      surveysUpdatedAt: stamp, noticesUpdatedAt: stamp,
    }, { portalHtml: '<div id="portal-body"></div>' });
    return { methods, schedule: result.schedule, warnings: result.warnings };
  });
  expect(result.methods).toEqual(["GET", "POST", "POST", "POST"]);
  expect(result.schedule[0].title).toBe("保存済み合成科目");
  expect(result.warnings.join()).toContain("8週間先まで取得できませんでした");
});

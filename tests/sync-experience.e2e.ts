import { expect, test, type Page } from "@playwright/test";
import { CLE_CACHE_KEY, GRADES_CACHE_KEY, KOAN_CACHE_KEY, ONBOARDING_KEY, PRIVACY_VERSION, TERMS_VERSION } from "../src/storage";
import { GENRES } from "../src/koan";
import { SYNC_STATE_KEY } from "../src/sync";

// Only synthetic records and responses. No university session is used.
async function setup(page: Page, options: { auto?: boolean; gradesAge?: number; noticesAge?: number; recentAge?: number; hidden?: boolean; failGrades?: boolean; emptyGrades?: boolean; holdGrades?: boolean; cleMessageWarning?: boolean; cleMessageRecovery?: boolean; cleTerminalLoop?: boolean } = {}) {
  await page.addInitScript(({ keys, options, versions }) => {
    const now = new Date().toISOString();
    const before = (age = 0) => new Date(Date.now() - age).toISOString();
    if (!localStorage.getItem("sync-fixture")) {
      localStorage.setItem("sync-fixture", "1");
      localStorage.setItem(keys.onboarding, JSON.stringify({ completed: true, termsVersion: versions.terms, privacyVersion: versions.privacy, acceptedAt: now }));
      localStorage.setItem(keys.koan, JSON.stringify({
        schedule: [], courses: [], changes: [], surveys: [], notices: [], lightUpdatedAt: now,
        snapshotVersion: 2, snapshotComplete: true, snapshotUpdatedAt: before(options.noticesAge),
        scheduleUpdatedAt: now, futureScheduleUpdatedAt: now, coursesUpdatedAt: now,
        changesUpdatedAt: before(options.recentAge), futureChangesUpdatedAt: now,
        surveysUpdatedAt: now, noticesUpdatedAt: before(options.recentAge), warnings: [],
      }));
      localStorage.setItem(keys.cle, JSON.stringify({
        courses: [], tasks: [], messages: options.cleMessageWarning ? [{ courseId: "cached-course", courseName: "保存済み連絡", unreadCount: 2 }] : [], unreadMessages: options.cleMessageWarning ? 2 : 0, updatedAt: now,
        coursesUpdatedAt: now, tasksUpdatedAt: now, messagesUpdatedAt: options.cleMessageWarning ? before(120_000) : now, taskStatusesUpdatedAt: now,
        taskScopeVersion: 3, announcements: [], announcementsPendingCount: 0, warnings: [],
        messagesComplete: !options.cleMessageRecovery,
      }));
      if (!options.emptyGrades) localStorage.setItem(keys.grades, JSON.stringify({
        creditsTotal: 42, cumulativeGpa: "3.25", termGpas: [], groups: [], courses: [], history: [], updatedAt: before(options.gradesAge),
      }));
    }
    const state = window as any;
    state.syncCalls = [];
    state.failGrades = Boolean(options.failGrades);
    state.holdGrades = Boolean(options.holdGrades);
    state.autoSyncEnabled = options.auto !== false;
    state.loginReady = true;
    if (options.hidden) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const table = (headers: string[]) => `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody></tbody></table>`;
    const gradeResult = table(["時間割コード", "開講科目名", "教員氏名", "評語", "合否"]) + table(["科目詳細区分", "科目小区分", "科目名", "単位数", "合否"]) + "<table><tr><th>修得単位数</th><td>48</td></tr></table>";
    Object.defineProperty(window, "chrome", { configurable: true, value: { runtime: { sendMessage: async (message: any) => {
      state.syncCalls.push(message.type);
      if (message.type === "auth-settings") return { ok: true, configured: true, enabled: state.autoSyncEnabled, mfaEnabled: true, autoSubmit: true, idHint: "fixture" };
      if (message.type === "auth-check-login") return { ok: true, koanLoggedIn: state.loginReady, cleLoggedIn: state.loginReady };
      if (message.type === "auth-claim-dashboard-refresh") return { ok: true, allowed: true };
      if (message.type === "auth-ensure-koan") return { ok: true, tabId: 1, portalHtml: '<div id="portal-body"></div>', portalUrl: "https://koan.osaka-u.ac.jp/campusweb/campusportal.do?page=main" };
      if (message.type === "auth-ensure-cle") return { ok: true, tabId: 2 };
      if (message.type === "koan-fetch") {
        if (state.holdGrades) await new Promise((resolve) => { state.releaseGrades = resolve; });
        if (state.failGrades) return { ok: false, error: "fixture grade unavailable" };
        return { ok: true, tabId: 1, response: { ok: true, status: 200, url: message.request.url,
          text: message.request.options?.method === "POST" ? gradeResult : '<form><input name="_flowExecutionKey" value="fixture-flow"></form>',
        } };
      }
      if (message.type === "cle-fetch") {
        const url = new URL(message.request.url);
        if (options.cleTerminalLoop && url.pathname.includes("/messages/summary")) {
          const offset = Number(url.searchParams.get("offset") || 0);
          const limit = Number(url.searchParams.get("limit") || 100);
          return { ok: true, response: { ok: true, status: 200, text: JSON.stringify({
            results: offset === 0 ? [{ courseId: "terminal-course", courseName: "終端検証科目", numUnreadMessages: 2 }] : [],
            paging: { offset, limit: limit === 1 ? 1 : 25, nextPage: `/learn/api/v1/messages/summary?offset=1&limit=${limit}` },
          }) } };
        }
        if (options.cleMessageRecovery && url.pathname.includes("/messages/summary")) {
          const offset = Number(url.searchParams.get("offset") || 0);
          return { ok: true, response: { ok: true, status: 200, text: JSON.stringify({
            results: offset < 17 ? [{ courseId: `recovery-${offset}`, courseName: `確認用科目${offset}`, numUnreadMessages: 1 }] : [],
            paging: { nextPage: offset < 17 ? `/learn/api/v1/messages/summary?offset=${offset}&limit=100` : null },
          }) } };
        }
        if (options.cleMessageWarning && url.pathname.includes("/messages/summary")) {
          const offset = Number(url.searchParams.get("offset") || 0);
          return {
            ok: true,
            response: {
              ok: true,
              status: 200,
              text: JSON.stringify({
                results: [{ courseId: `fetched-${offset}`, courseName: "取得途中の科目", numUnreadMessages: 1 }],
                paging: { nextPage: `/learn/api/v1/messages/summary?offset=${offset + 100}&limit=100` },
              }),
            },
          };
        }
        return { ok: true, response: { ok: true, status: 200, text: '{"results":[]}' } };
      }
      return { ok: true };
    } } } });
  }, { keys: { onboarding: ONBOARDING_KEY, koan: KOAN_CACHE_KEY, cle: CLE_CACHE_KEY, grades: GRADES_CACHE_KEY }, options, versions: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION } });
  const requests: string[] = [];
  await page.route("https://koan.osaka-u.ac.jp/**", async (route) => {
    const url = route.request().url();
    requests.push(url);
    const root = GENRES.map((genre, i) => `<a href="?fixtureGenre=${i}">${genre}</a>`).join("");
    await route.fulfill({ status: 200, contentType: "text/html", body: url.includes("fixtureGenre=") ? "<p>掲示はありません</p>" : url.includes("KHW0001100") ? '<table class="kyuko-kyukohoko"></table>' : root });
  });
  // Catch any accidental real upstream request in new/changed code paths.
  await page.route("https://www.cle.osaka-u.ac.jp/**", (route) => route.abort());
  return requests;
}
async function calls(page: Page, type: string) {
  return page.evaluate((type) => (window as any).syncCalls.filter((value: string) => value === type).length, type);
}
async function gradesCredits(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").creditsTotal, GRADES_CACHE_KEY);
}

test("fresh reloads and repeated clicks use cache without authentication or upstream requests", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByText(/直近の確認結果/)).toBeVisible();
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByText(/直近の確認結果/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  expect(await calls(page, "auth-ensure-koan")).toBe(0);
  expect(await calls(page, "auth-ensure-cle")).toBe(0);
  expect(requests).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("manual refresh only fetches expired recent categories, then reuses its result", async ({ page }) => {
  const requests = await setup(page, { recentAge: 120_000 });
  await page.goto("/");
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { name: "更新", exact: true })).toBeEnabled();
  expect(requests.some((url) => url.includes("KJW0001100"))).toBe(true);
  expect(requests.some((url) => url.includes("KHW0001100"))).toBe(true);
  expect(await calls(page, "auth-ensure-cle")).toBe(0);
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByText(/通信せずに表示/)).toBeVisible();
  expect(requests.length).toBe(2);
});

test("grades and bulletin snapshots sync automatically without opening their pages", async ({ page }) => {
  const requests = await setup(page, { gradesAge: 7 * 3600_000, noticesAge: 7 * 3600_000 });
  await page.goto("/");
  await expect.poll(() => gradesCredits(page)).toBe(48);
  await expect.poll(() => page.evaluate((key) => Date.now() - Date.parse(JSON.parse(localStorage.getItem(key)!).snapshotUpdatedAt), KOAN_CACHE_KEY), { timeout: 25_000 }).toBeLessThan(60_000);
  expect(await calls(page, "koan-fetch")).toBe(4);
  expect(requests).toHaveLength(GENRES.length + 1);
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/sync-home.png", fullPage: true });
});

test("hidden and offline pages wait until visible and connected", async ({ page, context }) => {
  await setup(page, { hidden: true, gradesAge: 7 * 3600_000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  expect(await calls(page, "auth-ensure-koan")).toBe(0);
  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const syncDetails = page.locator(".sync-details");
  await expect(syncDetails.locator("summary")).toContainText("オフライン · 保存済みを表示");
  await expect(page.locator(".offline-banner")).toHaveCount(0);
  await syncDetails.locator("summary").click();
  await expect(syncDetails.locator(".sync-offline-note")).toBeVisible();
  await expect(syncDetails.locator(".sync-offline-note")).toContainText("接続後");
  await page.keyboard.press("Escape");
  await expect(syncDetails).not.toHaveAttribute("open", "");
  expect(await calls(page, "auth-ensure-koan")).toBe(0);
  await context.setOffline(false);
  await expect.poll(() => gradesCredits(page)).toBe(48);
});

test("cached content keeps a sync warning in the consolidated header only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { auto: false, cleMessageWarning: true });
  await page.goto("/");

  await expect(page.getByText("保存済み連絡", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByText("保存済み連絡", { exact: true })).toBeVisible();
  await expect(page.locator("main .page-source-status, main .source-status-strip")).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);

  const details = page.locator(".sync-details");
  await expect(details.locator("summary")).toContainText("同期の詳細", { timeout: 25_000 });
  await expect(details.locator("summary")).toContainText("一部の情報を更新できませんでした");
  await details.locator("summary").click();
  await expect(details.locator(".source-status")).toHaveCount(4);
  await expect(details.locator(".source-status-partial")).toBeVisible();
  await expect(details.locator(".source-status-partial .source-status-message")).toHaveCount(1);
  await expect(details.locator(".source-status-partial .source-status-message")).toContainText("メッセージ");
  await expect(page.locator("main").getByText(/一部未取得|取得済み分だけ/, { exact: false })).toHaveCount(0);
  await expect(page.locator("header").getByText("一部の情報を更新できませんでした", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: "/tmp/koan-header-desktop.png", fullPage: false });
});

test("message recovery continues automatically across page budgets without failure backoff", async ({ page }) => {
  await page.clock.install();
  await setup(page, { cleMessageRecovery: true });
  await page.goto("/");
  const cache = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), CLE_CACHE_KEY);
  const failures = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").dashboard?.failures, SYNC_STATE_KEY);

  await expect.poll(async () => (await cache()).messagesNextPage).toContain("offset=7");
  await expect.poll(failures).toBe(0);
  await page.clock.fastForward(60_001);
  await expect.poll(async () => (await cache()).messagesNextPage).toContain("offset=13");
  await expect.poll(failures).toBe(0);
  await page.clock.fastForward(60_001);
  await expect.poll(async () => (await cache()).messagesComplete).toBe(true);
  const result = await cache();
  expect(result.messagesNextPage).toBeNull();
  expect(result.unreadMessages).toBe(17);
  expect(result.messages.map((item: { courseId: string }) => item.courseId).sort()).toEqual(
    Array.from({ length: 17 }, (_, i) => `recovery-${i}`).sort(),
  );
  expect(result.warnings).toEqual([]);
  await expect.poll(failures).toBe(0);
});

test("failed auto sync preserves grades and backs off across focus and reload", async ({ page }) => {
  await page.clock.install();
  await setup(page, { gradesAge: 7 * 3600_000, failGrades: true });
  await page.goto("/");
  await expect.poll(() => calls(page, "koan-fetch")).toBe(1);
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await page.clock.fastForward(90_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  expect(await calls(page, "koan-fetch")).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  expect(await calls(page, "koan-fetch")).toBe(0);
  await page.evaluate(() => { (window as any).failGrades = false; });
  await page.clock.fastForward(60_000);
  await expect.poll(() => gradesCredits(page)).toBe(48);
});

test("simultaneous tabs share the grade result instead of fetching it twice", async ({ page, context }) => {
  await setup(page, { auto: false, gradesAge: 7 * 3600_000 });
  await page.goto("/");
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await page.evaluate(() => { (window as any).holdGrades = true; });
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect.poll(() => calls(page, "koan-fetch")).toBe(1);
  const second = await context.newPage();
  await setup(second, { gradesAge: 7 * 3600_000 });
  await second.goto("/");
  await second.getByRole("button", { name: "成績", exact: true }).click();
  await second.getByRole("button", { name: "更新", exact: true }).click();
  await expect(second.getByText(/別の更新が進行中/)).toBeVisible();
  expect(await calls(second, "koan-fetch")).toBe(0);
  await page.evaluate(() => { (window as any).holdGrades = false; (window as any).releaseGrades(); });
  await expect(second.getByText("48", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "更新", exact: true }).click();
  await expect(second.getByText(/通信せずに表示/)).toBeVisible();
  expect(await calls(page, "koan-fetch")).toBe(4);
  expect(await calls(second, "koan-fetch")).toBe(0);
});

test("queued manual refresh resumes automatically after the retry guard", async ({ page }) => {
  await page.clock.install();
  await setup(page, { auto: false, gradesAge: 120_000 });
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ grades: { retryAt: Date.now() + 30_000, failures: 0 } })), SYNC_STATE_KEY);
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByText(/更新は自動で再試行します/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await calls(page, "auth-ensure-koan")).toBe(0);
  await page.clock.fastForward(60_000);
  await expect.poll(() => gradesCredits(page)).toBe(48);
});

test("first-load placeholders allow navigation and preserve background progress", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { auto: false, emptyGrades: true });
  await page.goto("/");
  await page.evaluate(() => { (window as any).holdGrades = true; });
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.locator(".loading-placeholder")).toBeVisible();
  await expect(page.getByText("画面を切り替えても取得は続きます。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/sync-loading-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByText(/成績を同期中/)).toBeVisible();
  await page.evaluate(() => { (window as any).holdGrades = false; (window as any).releaseGrades(); });
  await expect.poll(() => gradesCredits(page)).toBe(48);
});


test("manual login confirmation does not consume the dashboard request claim", async ({ page }) => {
  const requests = await setup(page, { auto: false, recentAge: 120_000 });
  await page.goto("/");
  await page.evaluate(() => { (window as any).loginReady = false; });
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await calls(page, "auth-claim-dashboard-refresh")).toBe(0);
  await page.getByRole("button", { name: "ログイン画面を開く", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(await calls(page, "auth-claim-dashboard-refresh")).toBe(1);
});

test("partial bulletin sync resumes without refetching completed genres", async ({ page }) => {
  const requests = await setup(page, { auto: false });
  await page.goto("/");
  await page.evaluate(({ key, genres }) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    data.snapshotComplete = false;
    data.snapshotGenreSyncAt = Object.fromEntries(genres.slice(0, -1).map((genre) => [genre, new Date().toISOString()]));
    data.snapshotGenreVersions = Object.fromEntries(genres.slice(0, -1).map((genre) => [genre, 2]));
    data.notices = [{ title: "保存済みの合成掲示", href: "https://koan.osaka-u.ac.jp/campusweb/fixture?keijino=fixture-1", genre: genres[0], priority: "", unread: false, department: "", author: "", period: "", live: true }];
    localStorage.setItem(key, JSON.stringify(data));
  }, { key: KOAN_CACHE_KEY, genres: GENRES });
  await page.getByRole("button", { name: "掲示", exact: true }).click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).snapshotComplete, KOAN_CACHE_KEY)).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain(`fixtureGenre=${GENRES.length - 1}`);
  await expect(page.getByText("保存済みの合成掲示", { exact: true })).toBeVisible();
});


test("disabling auto-login during a sync stops the remaining automatic jobs", async ({ page }) => {
  const requests = await setup(page, { holdGrades: true, gradesAge: 7 * 3600_000, noticesAge: 7 * 3600_000 });
  await page.goto("/");
  await expect.poll(() => calls(page, "koan-fetch")).toBe(1);
  await page.evaluate(() => {
    (window as any).autoSyncEnabled = false;
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => calls(page, "auth-settings")).toBeGreaterThan(2);
  await page.evaluate(() => { (window as any).holdGrades = false; (window as any).releaseGrades(); });
  await expect.poll(() => gradesCredits(page)).toBe(48);
  expect(requests).toEqual([]);
});


test("a verified terminal self-loop recovers messages and clears only that collection's warning", async ({ page }) => {
  await setup(page, { auto: false, cleTerminalLoop: true });
  await page.addInitScript((key) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    data.messagesComplete = false;
    data.messagesPendingCount = 1;
    data.warnings = ["メッセージ: CLEメッセージの次ページカーソルが前進しなかったため、取得済み分だけを保持しました。"];
    localStorage.setItem("koan-plus-cle-messages-failure-v1", JSON.stringify({ count: 6, nextRetryAt: Date.now() + 3600_000 }));
    localStorage.setItem("koan-plus-sync-state-v1", JSON.stringify({ dashboard: { failures: 6, retryAt: Date.now() + 3600_000 } }));
    localStorage.setItem(key, JSON.stringify(data));
  }, CLE_CACHE_KEY);
  await page.goto("/");
  await expect(page.locator(".next-actions")).not.toContainText("CLEの課題を確認できていません");
  await page.locator(".sync-details summary").click();
  await expect(page.locator(".sync-popover .source-status-partial")).toContainText("次ページカーソル");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).messagesComplete, CLE_CACHE_KEY)).toBe(true);
  await expect(page.getByText("終端検証科目", { exact: true })).toBeVisible();
  await expect(page.locator(".sync-details summary")).not.toContainText("一部の情報を更新できませんでした");
});

test("a failed manual refresh stays queued with automatic login disabled", async ({ page }) => {
  await page.clock.install();
  await setup(page, { auto: false, gradesAge: 7 * 3600_000, failGrades: true });
  await page.goto("/");
  await page.getByRole("button", { name: "成績", exact: true }).click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await page.locator(".sync-details summary").click();
  await expect(page.getByText(/fixture grade unavailable/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).failGrades = false; });
  await page.clock.fastForward(150_000);
  await expect.poll(() => gradesCredits(page)).toBe(48);
});

test("explicit grade retry escapes an old failure backoff while automatic retries remain bounded", async ({ page }) => {
  await setup(page, { auto: false, gradesAge: 7 * 3600_000 });
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ grades: { retryAt: Date.now() + 62 * 60_000, failures: 6 } })), SYNC_STATE_KEY);
  await page.getByRole("button", { name: "成績", exact: true }).click();
  expect(await calls(page, "koan-fetch")).toBe(0);
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect.poll(() => gradesCredits(page)).toBe(48);
  expect(await calls(page, "koan-fetch")).toBe(4);
});

import { expect, test, type Page } from "@playwright/test";
import {
  CLE_CACHE_KEY,
  CLE_MATERIALS_CACHE_KEY,
  GRADES_CACHE_KEY,
  KOAN_CACHE_KEY,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "../src/storage";

const ONBOARDING_KEY = "koan-plus-onboarding-v1";
const THEME_KEY = "koan-plus-theme";
function onboardingRecord() {
  return {
    completed: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: new Date().toISOString(),
  };
}

function fixture({ loaded = true } = {}) {
  const updatedAt = loaded ? new Date().toISOString() : null;
  return {
    onboarding: onboardingRecord(),
    koan: {
      schedule: [],
      courses: [],
      changes: [],
      surveys: [],
      notices: [],
      lightUpdatedAt: updatedAt,
      snapshotUpdatedAt: updatedAt,
      scheduleUpdatedAt: updatedAt,
      futureScheduleUpdatedAt: updatedAt,
      coursesUpdatedAt: updatedAt,
      changesUpdatedAt: updatedAt,
      futureChangesUpdatedAt: updatedAt,
      surveysUpdatedAt: updatedAt,
      noticesUpdatedAt: updatedAt,
      snapshotVersion: 2,
      snapshotComplete: true,
      warnings: [],
    },
    cle: {
      courses: [],
      tasks: [],
      messages: [],
      unreadMessages: 0,
      updatedAt,
      coursesUpdatedAt: updatedAt,
      tasksUpdatedAt: updatedAt,
      messagesUpdatedAt: updatedAt,
      taskStatusesUpdatedAt: updatedAt,
      taskScopeVersion: 3,
      taskStatusCursor: 0,
      warnings: [],
    },
  };
}

async function seed(page: Page, value: ReturnType<typeof fixture>) {
  await page.addInitScript(({ keys, value: initialValue }) => {
    localStorage.setItem(keys.onboarding, JSON.stringify(initialValue.onboarding));
    localStorage.setItem(keys.koan, JSON.stringify(initialValue.koan));
    localStorage.setItem(keys.cle, JSON.stringify(initialValue.cle));
    localStorage.setItem(keys.theme, "light");
  }, {
    keys: {
      onboarding: ONBOARDING_KEY,
      koan: KOAN_CACHE_KEY,
      cle: CLE_CACHE_KEY,
      theme: THEME_KEY,
    },
    value,
  });
}

async function seedOnce(page: Page, value: ReturnType<typeof fixture>) {
  await page.addInitScript(({ keys, value: initialValue }) => {
    const marker = "koan-plus-ui-fixture-seeded";
    if (sessionStorage.getItem(marker)) return;
    sessionStorage.setItem(marker, "1");
    localStorage.setItem(keys.onboarding, JSON.stringify(initialValue.onboarding));
    localStorage.setItem(keys.koan, JSON.stringify(initialValue.koan));
    localStorage.setItem(keys.cle, JSON.stringify(initialValue.cle));
    localStorage.setItem(keys.theme, "light");
  }, {
    keys: {
      onboarding: ONBOARDING_KEY,
      koan: KOAN_CACHE_KEY,
      cle: CLE_CACHE_KEY,
      theme: THEME_KEY,
    },
    value,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  )).toBe(true);
}

test("390px navigation stays compact and skip link reaches the main content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, fixture());
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "画面切替" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("button", { name: "設定", exact: true })).toBeVisible();

  const skipLink = page.getByRole("link", { name: "本文へ移動" });
  await skipLink.focus();
  await skipLink.click();
  await expect(page.locator("#main-content")).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("1024px settings collapses to one column without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, fixture());
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).click();

  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "データ管理", exact: true })).toBeVisible();
  const columnCount = await page.locator(".settings-container").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  expect(columnCount).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test("sync details close on view change and focus leaving the popover", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, fixture());
  await page.goto("/");

  const details = page.locator(".sync-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "授業", exact: true }).click();
  await expect(details).not.toHaveAttribute("open", "");

  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "設定", exact: true }).focus();
  await expect(details).not.toHaveAttribute("open", "");
});

test("cache deletion requires confirmation and preserves onboarding", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seedOnce(page, fixture());
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).click();

  await page.getByRole("button", { name: "キャッシュを削除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "キャッシュを削除して再読み込みしますか", exact: true })).toBeVisible();
  await expect(page.getByText(/認証情報・二段階認証情報・テーマ・利用規約への同意は削除されません/)).toBeVisible();
  await expect(page.getByRole("button", { name: "削除して再読み込み", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.getByRole("heading", { name: "データ管理", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KOAN_CACHE_KEY)).not.toBeNull();

  await page.getByRole("button", { name: "キャッシュを削除", exact: true }).click();
  await page.getByRole("button", { name: "削除して再読み込み", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KOAN_CACHE_KEY)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), CLE_CACHE_KEY)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_KEY)).not.toBeNull();
});

test("fresh, idle and partial refresh states remain distinguishable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, fixture({ loaded: false }));
  await page.goto("/");

  const details = page.locator(".sync-details");
  await expect(details.locator("summary")).toContainText("同期の詳細");
  await expect(page.locator("main .page-source-status, main .source-status-strip")).toHaveCount(0);
  await expect(page.locator(".collection-feedback").filter({ hasText: "はまだ取得していません" }).first()).toBeVisible();
  await details.locator("summary").click();
  await expect(details.locator(".sync-popover")).toBeVisible();
  await expect(details.locator(".source-status")).toHaveCount(4);
  await expect(details.locator(".source-status-name")).toHaveText(["KOAN", "CLE", "掲示", "成績"]);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).not.toHaveAttribute("open", "");

  await page.reload();
  await seed(page, fixture());
  await page.reload();
  await page.locator(".sync-details summary").click();
  await expect(page.locator(".sync-details .source-status-fresh")).toHaveCount(3);
  await expect(page.locator(".sync-details .source-status-idle")).toHaveCount(1);
  await expect(page.getByText("最終成功", { exact: false }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.addInitScript(({ koanKey, gradesKey }) => {
    const koan = JSON.parse(localStorage.getItem(koanKey)!);
    koan.changesUpdatedAt = koan.noticesUpdatedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    localStorage.setItem(koanKey, JSON.stringify(koan));
    localStorage.setItem(gradesKey, JSON.stringify({ creditsTotal: 0, cumulativeGpa: "", termGpas: [], groups: [], courses: [], history: [], updatedAt: new Date().toISOString() }));
    const chromeMock = {
      runtime: {
        sendMessage: async (message: { type?: string }) => {
          if (message.type === "auth-settings") {
            return { ok: true, configured: true, enabled: true, autoSubmit: true, mfaEnabled: true, idHint: "fixture" };
          }
          if (message.type === "auth-get-secrets") return { ok: true, configured: false };
          if (message.type === "auth-claim-startup-refresh") return { ok: true, shouldRefresh: false };
          if (message.type === "auth-claim-dashboard-refresh") return { ok: true, allowed: true };
          if (message.type === "auth-ensure-koan") {
            return {
              ok: true,
              tabId: 1,
              portalHtml: "<html><body><div id='portal-body'></div></body></html>",
              portalUrl: "https://koan.osaka-u.ac.jp/campusweb/campusportal.do?page=main",
            };
          }
          if (message.type === "auth-ensure-cle") return { ok: true, tabId: 2 };
          if (message.type === "cle-fetch") {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            return { ok: false, error: "fixture partial failure" };
          }
          return { ok: true };
        },
      },
    };
    Object.defineProperty(window, "chrome", { configurable: true, value: chromeMock });
  }, { koanKey: KOAN_CACHE_KEY, gradesKey: GRADES_CACHE_KEY });
  await page.route("https://koan.osaka-u.ac.jp/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      body: "<html><body></body></html>",
      headers: { "access-control-allow-origin": "*", "content-type": "text/html" },
      status: 200,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "更新中…", exact: true })).toBeVisible();
  const syncDetails = page.locator(".sync-details");
  await expect(syncDetails.locator("summary")).toContainText("同期の詳細", { timeout: 10_000 });
  await syncDetails.locator("summary").click();
  await expect(syncDetails.locator(".source-status-partial").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("main .page-source-status, main .source-status-strip")).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  await expect(page.locator("header .source-status")).toHaveCount(4);
});

test("grades tables expose captions and column scopes", async ({ page }) => {
  await seed(page, fixture());
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: GRADES_CACHE_KEY,
    value: {
      creditsTotal: 2,
      cumulativeGpa: "3.50",
      termGpas: [{ year: "2026", term: "前期", gpa: "3.50" }],
      groups: [{
        name: "専門",
        credits: 2,
        courses: [{
          majorCategory: "専門",
          minorCategory: "必修",
          course: "脳科学",
          credits: 2,
          year: "2026",
          term: "前期",
          grade: "A",
          pass: "合格",
        }],
      }],
      courses: [],
      history: [{
        code: "A-1",
        course: "脳科学",
        teacher: "教員",
        year: "2026",
        grade: "A",
        pass: "合格",
      }],
      updatedAt: new Date().toISOString(),
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "成績", exact: true }).click();

  await expect(page.locator("table.record-table caption.sr-only")).toHaveCount(3);
  const headersHaveColumnScope = await page.locator("table.record-table th").evaluateAll((headers) =>
    headers.length > 0 && headers.every((header) => header.getAttribute("scope") === "col"),
  );
  expect(headersHaveColumnScope).toBe(true);
});

test("material download controls name the item and batch count", async ({ page }) => {
  const value = fixture();
  Object.assign(value.koan, {
    courses: [{
      code: "C-1",
      departmentCode: "",
      year: "2026",
      title: "資料授業",
      day: "月",
      period: "1",
      teacherAndRoom: "教員 / A101",
      syllabusUrl: "",
    }],
  });
  Object.assign(value.cle, {
    courses: [{
      courseId: "cle-1",
      displayId: "",
      timetableCode: "C-1",
      name: "資料授業",
      available: true,
    }],
  });
  await seed(page, value);
  await page.addInitScript(({ key, courseId, updatedAt }) => {
    localStorage.setItem(key, JSON.stringify({
      [courseId]: {
        courseId,
        materials: [
          {
            id: "material-1",
            contentId: "content-1",
            attachmentId: "attachment-1",
            title: "講義資料",
            fileName: "lecture.pdf",
            mimeType: "application/pdf",
            size: 1024,
            addedAt: updatedAt,
            folderPath: [],
            downloadUrl: "https://www.cle.osaka-u.ac.jp/materials/lecture.pdf",
          },
          {
            id: "material-2",
            contentId: "content-2",
            attachmentId: "attachment-2",
            title: "演習資料",
            fileName: "exercise.pdf",
            mimeType: "application/pdf",
            size: 2048,
            addedAt: updatedAt,
            folderPath: [],
            downloadUrl: "https://www.cle.osaka-u.ac.jp/materials/exercise.pdf",
          },
        ],
        updatedAt,
        complete: true,
        warnings: [],
      },
    }));
  }, {
    key: CLE_MATERIALS_CACHE_KEY,
    courseId: "cle-1",
    updatedAt: new Date().toISOString(),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "授業", exact: true }).click();
  await page.getByRole("button", { name: /資料授業/ }).first().click();
  await page.getByRole("button", { name: "資料", exact: true }).click();

  await expect(page.getByRole("button", { name: "講義資料をダウンロード", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "演習資料をダウンロード", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "2件の資料をすべてダウンロード", exact: true })).toBeVisible();
});

test("unfetched resources do not claim there are no deadlines even when other data is cached", async ({ page }) => {
  const value = fixture();
  value.koan.scheduleUpdatedAt = null;
  value.koan.surveysUpdatedAt = null;
  value.cle.tasksUpdatedAt = null;
  await seed(page, value);
  await page.goto("/");
  await expect(page.locator(".next-actions .collection-feedback")).toContainText("はまだ取得していません");
  await expect(page.locator(".selected-deadline-panel .collection-feedback")).toContainText("はまだ取得していません");
  await expect(page.getByText("この日の締切はありません", { exact: true })).toHaveCount(0);
  await expect(page.getByText("直近のアクションはありません", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "時間割を取得", exact: true })).toBeVisible();
});

test("notice filters distinguish university importance and clear a zero-result search", async ({ page }) => {
  const value = fixture();
  Object.assign(value.koan, { notices: [
    { title: "試験の日程変更について", priority: "", href: "https://koan.osaka-u.ac.jp/fixture1", genre: "教務", unread: true, department: "全学", author: "教務係", period: "2026/09/05", live: true },
    { title: "登録内容のお知らせ", priority: "○", href: "https://koan.osaka-u.ac.jp/fixture2", genre: "教務", unread: false, department: "全学", author: "教務係", period: "2026/09/05", live: true },
  ] });
  await seed(page, value);
  await page.goto("/");
  await page.getByRole("button", { name: "掲示", exact: true }).click();
  await page.getByRole("button", { name: /大学の重要指定 1/ }).click();
  await expect(page.locator(".notice-results-summary")).toContainText("表示 1件 / 全 2件");
  await expect(page.getByRole("heading", { name: "試験の日程変更について", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /確認候補/ }).first().click();
  await expect(page.getByText("候補の理由：未読・件名に「試験」を含む", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "掲示を検索" }).fill("一致しない語句");
  await expect(page.locator(".notice-results-summary")).toContainText("表示 0件 / 全 2件");
  await page.getByRole("button", { name: "条件をクリア", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "掲示を検索" })).toHaveValue("");
  await expect(page.locator(".notice-results-summary")).toContainText("表示 2件 / 全 2件");
});

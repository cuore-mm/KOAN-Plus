chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

const AUTH_DB_NAME = "koan-plus-secrets-v1";
const AUTH_STORE_NAME = "vault";
const AUTH_RECORD_KEY = "primary";
const AUTH_ORIGIN = "https://ou-idp.auth.osaka-u.ac.jp";
const MFA_ORIGIN = "https://auth-mfa.auth.osaka-u.ac.jp";
const KOAN_PORTAL_URL = "https://koan.osaka-u.ac.jp/campusweb/campusportal.do?page=main";
const CLE_ORIGIN = "https://www.cle.osaka-u.ac.jp";
const CLE_HOME_URL = `${CLE_ORIGIN}/ultra`;
const CLE_PROBE_URL = `${CLE_ORIGIN}/learn/api/v1/messages/summary?offset=0&limit=1`;
const MFA_REGISTRATION_PATH = "/AttributeRegistSite/MfaInfoServlet";
const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const EXTENSION_ONLY_AUTH_TYPES = new Set([
  "auth-check-login",
  "auth-claim-startup-refresh",
  "auth-claim-dashboard-refresh",
  "auth-settings",
  "auth-get-secrets",
  "auth-focus-pending-mfa",
  "auth-delete",
  "auth-delete-mfa",
  "auth-save",
  "auth-ensure-koan",
  "auth-ensure-cle",
  "auth-refresh-cle",
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let koanLoginTask;
let cleLoginTask;
const manualFlows = new Map();
let pendingMfa = null;
const PENDING_MFA_KEY = "authPendingMfa";
const AUTO_COLLECT_TAB_IDS_KEY = "authAutoCollectTabIds";
const STARTUP_REFRESH_CLAIMED_KEY = "startupRefreshClaimed";
const DASHBOARD_REFRESH_ATTEMPT_KEY = "dashboardRefreshAttempt";
const autoCollectTabIds = new Set();
let startupRefreshClaimTask = Promise.resolve();
let dashboardRefreshClaimTask = Promise.resolve();

chrome.tabs.onRemoved.addListener((tabId) => {
  autoCollectTabIds.delete(tabId);
  void persistAutoCollectTabIds();
  void readPendingMfa().then((value) => {
    if (value?.tabId === tabId) return clearPendingMfa();
  }).catch(() => {});
});

const toBase64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

function senderUrl(sender) {
  try {
    return new URL(sender.url || sender.origin || "");
  } catch {
    return null;
  }
}

function isExtensionPageSender(sender) {
  const url = senderUrl(sender);
  return sender.id === chrome.runtime.id &&
    url?.protocol === "chrome-extension:" &&
    url.host === chrome.runtime.id;
}

function isIdpSender(sender) {
  const url = senderUrl(sender);
  return url?.origin === AUTH_ORIGIN && url.pathname.startsWith("/idp/");
}

function isMfaSender(sender) {
  return senderUrl(sender)?.origin === MFA_ORIGIN;
}

function isMfaRegistrationSender(sender) {
  const url = senderUrl(sender);
  return url?.origin === MFA_ORIGIN && url.pathname === MFA_REGISTRATION_PATH;
}

function isCleLoginSender(sender) {
  const url = senderUrl(sender);
  if (url?.origin !== CLE_ORIGIN) return false;
  return url.pathname === "/" ||
    url.pathname === "/ultra" ||
    url.pathname === "/ultra/" ||
    url.pathname === "/webapps/login" ||
    url.pathname.startsWith("/webapps/login/");
}

function requireExtensionPageSender(sender) {
  if (!isExtensionPageSender(sender)) {
    throw new Error("この操作はKOAN Plusの画面からのみ実行できます。");
  }
}

async function openAuthDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUTH_STORE_NAME)) {
        request.result.createObjectStore(AUTH_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAuthRecord() {
  const db = await openAuthDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, "readonly");
    const request = transaction.objectStore(AUTH_STORE_NAME).get(AUTH_RECORD_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function writeAuthRecord(record) {
  const db = await openAuthDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, "readwrite");
    transaction.objectStore(AUTH_STORE_NAME).put(record, AUTH_RECORD_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearAuthRecord() {
  const db = await openAuthDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, "readwrite");
    transaction.objectStore(AUTH_STORE_NAME).delete(AUTH_RECORD_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function encryptCredentials(credentials, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(credentials)),
  );
  return { iv: toBase64(iv), encrypted: toBase64(new Uint8Array(encrypted)) };
}

async function decryptCredentials(record) {
  if (!record?.key || !record?.payload) throw new Error("認証情報が設定されていません。");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(record.payload.iv) },
    record.key,
    fromBase64(record.payload.encrypted),
  );
  return JSON.parse(decoder.decode(decrypted));
}

function normalizeTotpSecret(secret) {
  return String(secret || "").toUpperCase().replace(/[\s=-]/g, "");
}

function decodeBase32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeTotpSecret(secret);
  if (!normalized || [...normalized].some((character) => !alphabet.includes(character))) {
    throw new Error("TOTP シークレットは Base32 形式で入力してください。");
  }
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function generateTotp(secret, now = Date.now()) {
  const counter = Math.floor(now / 30000);
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

async function readAuthSettings(record) {
  const current = record || await readAuthRecord();
  let idHint = "";
  let isConfigured = false;
  if (current?.payload) {
    try {
      const credentials = await decryptCredentials(current);
      if (credentials.id && credentials.password) {
        isConfigured = true;
        idHint = credentials.id.length <= 4
          ? "*".repeat(credentials.id.length)
          : `${credentials.id.slice(0, 2)}${"*".repeat(credentials.id.length - 4)}${credentials.id.slice(-2)}`;
      }
    } catch {
      idHint = "読み込み失敗";
      isConfigured = false;
    }
  }
  return {
    configured: isConfigured,
    enabled: Boolean(current?.enabled),
    autoSubmit: current?.autoSubmit !== false,
    mfaEnabled: Boolean(current?.mfaEnabled),
    idHint,
  };
}

async function probeKoanLogin() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(KOAN_PORTAL_URL, {
      credentials: "include",
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    const ok = response.ok &&
      new URL(response.url).origin === "https://koan.osaka-u.ac.jp" &&
      /id=["']portal-body["']/.test(text);
    return { ok, text: ok ? text : "", url: response.url };
  } catch {
    return { ok: false, text: "", url: KOAN_PORTAL_URL };
  } finally {
    clearTimeout(timeout);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function restoreAutoCollectTabIds() {
  if (!chrome.storage?.session) return;
  const stored = await chrome.storage.session.get(AUTO_COLLECT_TAB_IDS_KEY);
  const tabIds = Array.isArray(stored[AUTO_COLLECT_TAB_IDS_KEY])
    ? stored[AUTO_COLLECT_TAB_IDS_KEY]
    : [];
  autoCollectTabIds.clear();
  for (const tabId of tabIds) {
    if (Number.isInteger(tabId)) autoCollectTabIds.add(tabId);
  }
}

async function persistAutoCollectTabIds() {
  if (!chrome.storage?.session) return;
  await chrome.storage.session.set({
    [AUTO_COLLECT_TAB_IDS_KEY]: [...autoCollectTabIds],
  });
}

async function addAutoCollectTabId(tabId) {
  await restoreAutoCollectTabIds();
  autoCollectTabIds.add(tabId);
  await persistAutoCollectTabIds();
}

async function removeAutoCollectTabId(tabId) {
  await restoreAutoCollectTabIds();
  autoCollectTabIds.delete(tabId);
  await persistAutoCollectTabIds();
}

async function isAutoCollectTabId(tabId) {
  await restoreAutoCollectTabIds();
  return autoCollectTabIds.has(tabId);
}

async function savePendingMfa(value) {
  pendingMfa = value;
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [PENDING_MFA_KEY]: value });
  }
}

async function readPendingMfa() {
  if (!pendingMfa && chrome.storage?.session) {
    const stored = await chrome.storage.session.get(PENDING_MFA_KEY);
    pendingMfa = stored[PENDING_MFA_KEY] || null;
  }
  if (pendingMfa && Date.now() - Number(pendingMfa.createdAt || 0) > MFA_PENDING_TTL_MS) {
    pendingMfa = null;
    if (chrome.storage?.session) await chrome.storage.session.remove(PENDING_MFA_KEY);
  }
  return pendingMfa;
}

async function clearPendingMfa() {
  pendingMfa = null;
  if (chrome.storage?.session) {
    await chrome.storage.session.remove(PENDING_MFA_KEY);
  }
}

async function withTimeout(task, milliseconds) {
  let timeoutId;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function findKoanTab() {
  const tabs = await chrome.tabs.query({ url: "https://koan.osaka-u.ac.jp/*" });
  return tabs
    .filter((candidate) => !candidate.discarded && candidate.id)
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
}

async function waitForTabComplete(tabId, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return tab;
    } catch {
      throw new Error("KOANタブが閉じられたため、取得を中止しました。");
    }
    await wait(250);
  }
  throw new Error("KOANタブの読み込みが完了しませんでした。再読み込みして再試行してください。");
}

async function ensureKoanTab(active = false) {
  let tab = await findKoanTab();
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: KOAN_PORTAL_URL, active });
  } else if (active && !tab.active) {
    tab = await chrome.tabs.update(tab.id, { active: true });
  }
  if (!tab?.id) throw new Error("KOANタブを作成できませんでした。");
  await waitForTabComplete(tab.id);
  return tab;
}

async function focusTab(tabId) {
  if (!tabId) return;
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
}

async function returnToDashboard(flowTabId) {
  const flow = manualFlows.get(flowTabId);
  if (!flow) return;
  manualFlows.delete(flowTabId);
  await focusTab(flow.returnTabId);
  await chrome.tabs.remove(flowTabId).catch(() => {});
}

async function openLoginTab(url, record, sender, activeWhenManual = true) {
  const manual = !record?.enabled || !record.payload;
  const guideMfa = Boolean(record?.enabled && record.payload && !record.mfaEnabled);
  const tab = await chrome.tabs.create({
    url,
    active: manual ? activeWhenManual : false,
  });
  if ((manual || guideMfa) && tab.id) {
    manualFlows.set(tab.id, { returnTabId: sender?.tab?.id });
  }
  return { manual, tab };
}

async function ensureKoanLogin(record, sender, requireTab = false) {
  const initialProbe = await probeKoanLogin();
  if (initialProbe.ok) {
    const tab = requireTab ? await ensureKoanTab(false) : null;
    return {
      ok: true,
      loginStarted: false,
      portalHtml: initialProbe.text,
      portalUrl: initialProbe.url,
      tabId: tab?.id,
    };
  }
  if (koanLoginTask) {
    const result = await koanLoginTask;
    if (!requireTab || result.tabId) return result;
    const tab = await ensureKoanTab(false);
    return { ...result, tabId: tab.id };
  }

  koanLoginTask = (async () => {
    const { manual, tab } = await openLoginTab(KOAN_PORTAL_URL, record, sender);
    try {
      const deadline = Date.now() + 90 * 1000;
      while (Date.now() < deadline) {
        await wait(1000);
        if (tab.id && !await tabExists(tab.id)) {
          throw new Error("認証画面が閉じられたため、更新を中止しました。");
        }
        const probe = await probeKoanLogin();
        if (probe.ok) {
          if (tab.id) {
            const shouldReturn = manualFlows.has(tab.id);
            if (requireTab) {
              if (shouldReturn) {
                const flow = manualFlows.get(tab.id);
                manualFlows.delete(tab.id);
                await focusTab(flow?.returnTabId);
              }
              await waitForTabComplete(tab.id);
            } else if (shouldReturn) {
              await returnToDashboard(tab.id);
            } else {
              await chrome.tabs.remove(tab.id);
            }
          }
          return {
            ok: true,
            loginStarted: true,
            portalHtml: probe.text,
            portalUrl: probe.url,
            tabId: requireTab ? tab.id : undefined,
          };
        }
      }
      throw new Error(manual
        ? "認証が完了していません。開いた認証画面でログインしてください。"
        : "KOANの自動ログインが完了しませんでした。開いた認証画面を確認してから、もう一度更新してください。");
    } finally {
      if (tab.id) manualFlows.delete(tab.id);
      koanLoginTask = undefined;
    }
  })();
  return koanLoginTask;
}

async function cleApiReady(tabId) {
  try {
    const [execution] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, {
            credentials: "include",
            redirect: "follow",
            signal: controller.signal,
          });
          return {
            contentType: response.headers.get("content-type") || "",
            ok: response.ok,
          };
        } catch {
          return { contentType: "", ok: false };
        } finally {
          clearTimeout(timeout);
        }
      },
      args: [CLE_PROBE_URL],
    }), 7000);
    return execution?.result?.ok &&
      execution.result.contentType.toLowerCase().includes("application/json");
  } catch {
    return false;
  }
}

async function findCleTab() {
  const tabs = await chrome.tabs.query({ url: `${CLE_ORIGIN}/*` });
  return tabs
    .filter((candidate) => !candidate.discarded)
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
}

async function findReadyCleTab() {
  const tabs = await chrome.tabs.query({ url: `${CLE_ORIGIN}/*` });
  const candidates = tabs
    .filter((candidate) => !candidate.discarded && candidate.id)
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0));
  const readiness = await Promise.all(
    candidates.map((candidate) => cleApiReady(candidate.id)),
  );
  return candidates.find((candidate, index) => readiness[index]) || null;
}

async function focusPendingMfaTab() {
  const tabs = await chrome.tabs.query({ url: [
    `${AUTH_ORIGIN}/*`,
    `${MFA_ORIGIN}/*`,
    `${CLE_ORIGIN}/*`,
  ] });
  for (const tab of tabs) {
    if (!tab.id || tab.discarded) continue;
    try {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const text = `${document.title} ${document.body?.innerText || ""}`;
          const hasOtpInput = [...document.querySelectorAll("input")].some((input) => {
            const hint = [input.id, input.name, input.autocomplete, input.placeholder].join(" ");
            return input instanceof HTMLInputElement &&
              !["hidden", "checkbox", "submit", "button"].includes(input.type) &&
              (/otp|one-time|auth.?code|certification|secondaryAuthToken/i.test(hint) || input.maxLength === 6);
          });
          return hasOtpInput && /認証コード|ワンタイムパスワード|OTP|MFA認証|Type the Code/i.test(text);
        },
      });
      if (execution?.result === true) {
        await chrome.tabs.update(tab.id, { active: true });
        if (Number.isInteger(tab.windowId)) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
        return { found: true, tabId: tab.id };
      }
    } catch {
      // Ignore tabs that are navigating or cannot be inspected.
    }
  }
  return { found: false };
}

async function ensureCleLogin(record, sender, force = false) {
  let tab = !force ? await findReadyCleTab() : await findCleTab();
  if (!force && tab?.id) {
    return { ok: true, loginStarted: false, tabId: tab.id };
  }
  if (!tab?.id) tab = await findCleTab();
  if (cleLoginTask) return cleLoginTask;

  cleLoginTask = (async () => {
    const manual = !record?.enabled || !record.payload;
    const guideMfa = Boolean(record?.enabled && record.payload && !record.mfaEnabled);
    if (!tab?.id) {
      ({ tab } = await openLoginTab(CLE_HOME_URL, record, sender));
    } else {
      if (manual || guideMfa) manualFlows.set(tab.id, { returnTabId: sender?.tab?.id });
      await chrome.tabs.update(tab.id, { url: CLE_HOME_URL, active: manual });
    }
    try {
      const deadline = Date.now() + 45 * 1000;
      while (Date.now() < deadline) {
        await wait(1000);
        if (tab.id && !await tabExists(tab.id)) {
          throw new Error("CLE認証画面が閉じられたため、更新を中止しました。");
        }
        if (tab.id && await cleApiReady(tab.id)) {
          if (manualFlows.has(tab.id)) {
            const flow = manualFlows.get(tab.id);
            manualFlows.delete(tab.id);
            await focusTab(flow?.returnTabId);
          }
          return { ok: true, loginStarted: true, tabId: tab.id };
        }
      }
      throw new Error(manual
        ? "CLEの認証が完了していません。開いた認証画面でログインしてください。"
        : "CLEの自動再認証が完了しませんでした。CLEタブを確認してください。");
    } finally {
      if (tab?.id) manualFlows.delete(tab.id);
      cleLoginTask = undefined;
    }
  })();
  return cleLoginTask;
}

async function authResponse(message, sender) {
  if (EXTENSION_ONLY_AUTH_TYPES.has(message.type)) {
    requireExtensionPageSender(sender);
  }

  if (message.type === "auth-check-login") {
    const [koanProbe, cleTab] = await Promise.all([
      probeKoanLogin(),
      findReadyCleTab(),
    ]);
    return { ok: true, koanLoggedIn: koanProbe.ok, cleLoggedIn: Boolean(cleTab?.id) };
  }

  if (message.type === "auth-claim-startup-refresh") {
    const claim = startupRefreshClaimTask.then(async () => {
      if (!chrome.storage?.session) return true;
      const stored = await chrome.storage.session.get(STARTUP_REFRESH_CLAIMED_KEY);
      if (stored[STARTUP_REFRESH_CLAIMED_KEY]) return false;
      await chrome.storage.session.set({ [STARTUP_REFRESH_CLAIMED_KEY]: true });
      return true;
    });
    startupRefreshClaimTask = claim.then(() => undefined, () => undefined);
    return { ok: true, shouldRefresh: await claim };
  }

  if (message.type === "auth-claim-dashboard-refresh") {
    const claim = dashboardRefreshClaimTask.then(async () => {
      if (!chrome.storage?.session) return true;
      const stored = await chrome.storage.session.get(DASHBOARD_REFRESH_ATTEMPT_KEY);
      const previous = Number(stored[DASHBOARD_REFRESH_ATTEMPT_KEY]) || 0;
      const retryAfterMs = Math.max(0, 60 * 1000 - (Date.now() - previous));
      if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
      await chrome.storage.session.set({ [DASHBOARD_REFRESH_ATTEMPT_KEY]: Date.now() });
      return { allowed: true, retryAfterMs: 60 * 1000 };
    });
    dashboardRefreshClaimTask = claim.then(() => undefined, () => undefined);
    return { ok: true, ...await claim };
  }

  const record = await readAuthRecord();
  if (message.type === "auth-settings") return { ok: true, ...await readAuthSettings(record) };

  if (message.type === "auth-mfa-pending-save") {
    if (!isMfaRegistrationSender(sender) || !Number.isInteger(sender.tab?.id)) {
      throw new Error("MFA登録画面以外からは登録情報を仮保存できません。");
    }
    const { secret, temporaryCancelCode } = message;
    if (!secret || !temporaryCancelCode) {
      throw new Error("シークレットまたは一時解除コードが指定されていません。");
    }
    decodeBase32(secret); // Validate base32 secret
    const transactionId = crypto.randomUUID();
    await savePendingMfa({
      secret,
      temporaryCancelCode,
      tabId: sender.tab.id,
      transactionId,
      createdAt: Date.now(),
    });
    return { ok: true, code: await generateTotp(secret), transactionId };
  }

  if (message.type === "auth-mfa-click-proceed") {
    if (!isMfaRegistrationSender(sender)) {
      throw new Error("MFA情報画面以外では遷移操作を実行しません。");
    }
    if (!sender.tab?.id) throw new Error("MFA情報画面のタブを特定できませんでした。");
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: () => {
        const viewIdInput = document.querySelector('input[name="viewId"]');
        const isDisplayPage = viewIdInput?.value === "MfaInfoDisplay.jsp" ||
          document.body.innerText.includes("MFA情報表示");
        if (!isDisplayPage) {
          return { clicked: false, method: "not-display-page" };
        }

        if (typeof globalThis.execSrvStatus === "function") {
          globalThis.execSrvStatus("register");
          return { clicked: true, method: "execSrvStatus" };
        }

        const button = [...document.querySelectorAll('input[type="button"], input[type="submit"], button')].find((candidate) =>
          (candidate.value || "").includes("MFA登録に進む") ||
          (candidate.textContent || "").includes("MFA登録に進む")
        );
        if (button instanceof HTMLElement) {
          button.click();
          return { clicked: true, method: "button-click-main" };
        }

        const form = document.forms.namedItem("cmdForm") || document.querySelector("form");
        const methodName = document.querySelector('input[name="methodName"]');
        if (form instanceof HTMLFormElement && methodName instanceof HTMLInputElement) {
          methodName.value = "register";
          HTMLFormElement.prototype.submit.call(form);
          return { clicked: true, method: "form-submit-fallback" };
        }

        return { clicked: false, method: "no-target" };
      },
    });
    return { ok: true, ...(execution?.result || { clicked: false }) };
  }

  if (message.type === "auth-mfa-confirm-save") {
    if (!isMfaRegistrationSender(sender) || !Number.isInteger(sender.tab?.id)) {
      throw new Error("MFA登録画面以外からは登録を確定できません。");
    }
    const savedPendingMfa = await readPendingMfa();
    if (!savedPendingMfa) {
      return { ok: false, error: "仮保存されたMFA情報がありません。" };
    }
    if (
      savedPendingMfa.tabId !== sender.tab.id ||
      !message.transactionId ||
      message.transactionId !== savedPendingMfa.transactionId
    ) {
      throw new Error("MFA登録を開始したタブと確認要求が一致しません。");
    }
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => {
        const text = document.body?.innerText || "";
        return text.includes("MFA登録\t：\t登録済") ||
          text.includes("MFA登録 ： 登録済");
      },
    });
    if (execution?.result !== true) {
      throw new Error("MFA登録の完了画面を確認できませんでした。");
    }
    const current = record || await readAuthRecord();
    const previous = current?.payload ? await decryptCredentials(current) : {};
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const payload = await encryptCredentials({
      id: previous.id || "",
      password: previous.password || "",
      totpSecret: savedPendingMfa.secret,
      temporaryCancelCode: savedPendingMfa.temporaryCancelCode,
      mfaConsent: true,
    }, key);
    const hasSavedCredentials = Boolean(previous.id && previous.password);
    await writeAuthRecord({
      enabled: hasSavedCredentials ? Boolean(current?.enabled) : true,
      autoSubmit: true,
      mfaEnabled: true,
      key,
      payload,
    });
    await clearPendingMfa();
    return { ok: true };
  }

  if (message.type === "auth-get-secrets") {
    if (!record?.payload) {
      return { ok: true, configured: false };
    }
    try {
      const credentials = await decryptCredentials(record);
      return {
        ok: true,
        configured: Boolean(credentials.totpSecret),
        totpSecret: credentials.totpSecret || "",
        temporaryCancelCode: credentials.temporaryCancelCode || "",
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (message.type === "auth-mfa-register-auto-tab") {
    const requestedTabId = Number.isInteger(message.tabId) ? message.tabId : null;
    if (requestedTabId) {
      requireExtensionPageSender(sender);
    } else if (!isMfaRegistrationSender(sender)) {
      throw new Error("MFA登録画面以外からは自動取得タブを登録できません。");
    }
    const tabId = requestedTabId || sender.tab?.id;
    if (tabId) {
      await addAutoCollectTabId(tabId);
    }
    return { ok: true };
  }

  if (message.type === "auth-mfa-check-auto-tab") {
    if (!isMfaRegistrationSender(sender)) {
      throw new Error("MFA登録画面以外からは自動取得状態を確認できません。");
    }
    const isAuto = Boolean(sender.tab && await isAutoCollectTabId(sender.tab.id));
    return { ok: true, isAutoCollect: isAuto };
  }

  if (message.type === "auth-focus-pending-mfa") {
    return { ok: true, ...await focusPendingMfaTab() };
  }

  if (message.type === "auth-close-tab") {
    if (isMfaRegistrationSender(sender) &&
        sender.tab?.id &&
        await isAutoCollectTabId(sender.tab.id)) {
      await removeAutoCollectTabId(sender.tab.id);
      await chrome.tabs.remove(sender.tab.id);
      return { ok: true };
    }
    return { ok: false, error: "タブが特定できませんでした。" };
  }

  if (message.type === "auth-delete") {
    const record = await readAuthRecord();
    if (record?.payload) {
      try {
        const credentials = await decryptCredentials(record);
        if (credentials.totpSecret) {
          const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
          );
          const payload = await encryptCredentials({
            id: "",
            password: "",
            totpSecret: credentials.totpSecret,
            temporaryCancelCode: credentials.temporaryCancelCode || "",
            mfaConsent: credentials.mfaConsent,
          }, key);
          await writeAuthRecord({
            enabled: false,
            autoSubmit: true,
            mfaEnabled: false,
            key,
            payload,
          });
        } else {
          await clearAuthRecord();
        }
      } catch {
        await clearAuthRecord();
      }
    } else {
      await clearAuthRecord();
    }
    return { ok: true, ...await readAuthSettings(await readAuthRecord()) };
  }

  if (message.type === "auth-delete-mfa") {
    const record = await readAuthRecord();
    if (record?.payload) {
      try {
        const credentials = await decryptCredentials(record);
        if (credentials.id && credentials.password) {
          const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
          );
          const payload = await encryptCredentials({
            id: credentials.id,
            password: credentials.password,
            totpSecret: "",
            temporaryCancelCode: "",
            mfaConsent: false,
          }, key);
          await writeAuthRecord({
            enabled: record.enabled,
            autoSubmit: record.autoSubmit,
            mfaEnabled: false,
            key,
            payload,
          });
        } else {
          await clearAuthRecord();
        }
      } catch {
        await clearAuthRecord();
      }
    } else {
      await clearAuthRecord();
    }
    return { ok: true, ...await readAuthSettings(await readAuthRecord()) };
  }

  if (message.type === "auth-save") {
    const values = message.values || {};
    if (!values.enabled) {
      if (record?.payload) {
        await writeAuthRecord({
          ...record,
          enabled: false,
          autoSubmit: true,
        });
        return { ok: true, ...await readAuthSettings(await readAuthRecord()) };
      }
      return { ok: true, configured: false, enabled: false, autoSubmit: true, mfaEnabled: false, idHint: "" };
    }
    if (!values.id || !values.password) {
      if (!record?.payload) throw new Error("ID とパスワードを入力してください。");
    }
    const previous = record?.payload ? await decryptCredentials(record) : {};
    const nextId = values.id || previous.id || "";
    const nextPassword = values.password || previous.password || "";
    if (!nextId || !nextPassword) {
      throw new Error("ID とパスワードを入力してください。");
    }
    const totpSecret = normalizeTotpSecret(values.totpSecret) || previous.totpSecret || "";
    const mfaConsent = Boolean(totpSecret && (values.mfaConsent || previous.mfaConsent));
    if (values.mfaEnabled && !mfaConsent) {
      throw new Error("MFA 自動化のリスクを確認し、同意してください。");
    }
    if (values.mfaEnabled && !totpSecret) {
      throw new Error("TOTP シークレットを入力してください。");
    }
    if (totpSecret) decodeBase32(totpSecret);
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const payload = await encryptCredentials({
      id: nextId,
      password: nextPassword,
      totpSecret,
      temporaryCancelCode: previous.temporaryCancelCode || "",
      mfaConsent,
    }, key);
    await writeAuthRecord({
      enabled: true,
      autoSubmit: true,
      mfaEnabled: Boolean(values.mfaEnabled && totpSecret && mfaConsent),
      key,
      payload,
    });
    return { ok: true, ...await readAuthSettings(await readAuthRecord()) };
  }

  if (message.type === "auth-ensure-koan") {
    return ensureKoanLogin(record, sender, Boolean(message.requireTab));
  }

  if (message.type === "auth-ensure-cle") {
    return ensureCleLogin(record, sender);
  }

  if (message.type === "auth-refresh-cle") {
    return ensureCleLogin(record, sender, true);
  }

  if (message.type === "auth-auto-login-state") {
    if (!isIdpSender(sender) && !isCleLoginSender(sender)) {
      throw new Error("認証画面以外には自動ログイン状態を渡しません。");
    }
    const settings = await readAuthSettings(record);
    return {
      ok: true,
      enabled: Boolean(settings.enabled && settings.configured),
      autoSubmit: record?.autoSubmit !== false,
    };
  }

  if (message.type === "auth-credentials") {
    if (!isIdpSender(sender) && !isCleLoginSender(sender)) {
      throw new Error("認証画面以外には認証情報を渡しません。");
    }
    if (!record?.enabled) return { ok: true };
    const credentials = await decryptCredentials(record);
    if (!credentials.id || !credentials.password) {
      throw new Error("保存済みのIDまたはパスワードが不完全です。");
    }
    return { ok: true, credentials: { id: credentials.id, password: credentials.password }, autoSubmit: true };
  }

  if (message.type === "auth-submit-idp") {
    if (!isIdpSender(sender)) throw new Error("認証基盤以外ではログイン送信を実行しません。");
    if (!sender.tab?.id) throw new Error("認証基盤のタブを特定できませんでした。");
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: () => {
        if (typeof globalThis.LoginSubmit === "function") {
          globalThis.LoginSubmit("ログイン");
          return true;
        }
        const submit = document.querySelector('input[name="cmdForm.Submit"]');
        if (submit instanceof HTMLInputElement) {
          submit.click();
          return true;
        }
        return false;
      },
    });
    return { ok: true, submitted: execution?.result === true };
  }

  if (message.type === "auth-totp") {
    if (!isMfaSender(sender) && !isIdpSender(sender)) {
      throw new Error("MFA認証画面以外には認証コードを渡しません。");
    }
    if (!record?.enabled) return { ok: true };
    if (!record.mfaEnabled) {
      if (sender.tab?.id) {
        await chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
        if (Number.isInteger(sender.tab.windowId)) {
          await chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
        }
      }
      return { ok: true, mfaRequired: true };
    }
    const credentials = await decryptCredentials(record);
    if (!credentials.mfaConsent || !credentials.totpSecret) return { ok: true };
    return { ok: true, code: await generateTotp(credentials.totpSecret), autoSubmit: true };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (String(message?.type || "").startsWith("auth-")) {
    authResponse(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }

  const targets = {
    "koan-fetch": {
      label: "KOAN",
      origin: "https://koan.osaka-u.ac.jp",
      methods: ["GET", "POST"],
    },
    "cle-fetch": {
      label: "CLE",
      origin: "https://www.cle.osaka-u.ac.jp",
      methods: ["GET"],
    },
  };
  const target = targets[message?.type];
  if (!target) return;

  (async () => {
    requireExtensionPageSender(sender);
    const requestUrl = new URL(message.request?.url);
    const method = message.request?.options?.method || "GET";
    if (requestUrl.origin !== target.origin) {
      throw new Error(`${target.label}以外への通信は許可されていません。`);
    }
    if (!target.methods.includes(method)) {
      throw new Error("許可されていない通信方式です。");
    }

    const tabs = await chrome.tabs.query({
      url: `${target.origin}/*`,
    });
    const tab = message.tabId
      ? tabs.find((candidate) => candidate.id === message.tabId)
      : tabs
          .filter((candidate) => !candidate.discarded)
          .sort((left, right) => {
            if (left.active !== right.active) return left.active ? -1 : 1;
            return (right.lastAccessed || 0) - (left.lastAccessed || 0);
          })[0];
    if (!tab?.id) {
      throw new Error(`${target.label}をログイン済みのタブで開いてから取得してください。`);
    }

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (request, label) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(request.url, {
            credentials: "include",
            redirect: "follow",
            ...request.options,
            signal: controller.signal,
          });
          return {
            ok: response.ok,
            status: response.status,
            text: await response.text(),
            url: response.url,
          };
        } catch (error) {
          throw new Error(
            error?.name === "AbortError"
              ? `${label}の応答が15秒以内に返りませんでした。${label}タブを再読み込みして再試行してください。`
              : `${label}タブ内の取得に失敗しました: ${error?.message || String(error)}`,
          );
        } finally {
          clearTimeout(timeout);
        }
      },
      args: [message.request, target.label],
    });
    if (!execution.result) {
      throw new Error(`${target.label}タブから応答を取得できませんでした。`);
    }
    sendResponse({ ok: true, response: execution.result, tabId: tab.id });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return true;
});

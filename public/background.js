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
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let koanLoginTask;
let cleLoginTask;
const manualFlows = new Map();

const toBase64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

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
  if (current?.payload) {
    try {
      const credentials = await decryptCredentials(current);
      idHint = credentials.id.length <= 4
        ? "*".repeat(credentials.id.length)
        : `${credentials.id.slice(0, 2)}${"*".repeat(credentials.id.length - 4)}${credentials.id.slice(-2)}`;
    } catch {
      idHint = "保存済み";
    }
  }
  return {
    configured: Boolean(current?.payload),
    enabled: Boolean(current?.enabled),
    autoSubmit: current?.autoSubmit !== false,
    mfaEnabled: Boolean(current?.mfaEnabled),
    idHint,
  };
}

async function probeKoanLogin() {
  try {
    const response = await fetch(KOAN_PORTAL_URL, {
      credentials: "include",
      redirect: "follow",
    });
    return response.ok &&
      new URL(response.url).origin === "https://koan.osaka-u.ac.jp" &&
      /id=["']portal-body["']/.test(await response.text());
  } catch {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function returnToDashboard(flowTabId) {
  const flow = manualFlows.get(flowTabId);
  if (!flow) return;
  manualFlows.delete(flowTabId);
  if (flow.returnTabId) {
    await chrome.tabs.update(flow.returnTabId, { active: true }).catch(() => {});
  }
  await chrome.tabs.remove(flowTabId).catch(() => {});
}

async function openLoginTab(url, record, sender, activeWhenManual = true) {
  const manual = !record?.enabled || !record.payload;
  const tab = await chrome.tabs.create({
    url,
    active: manual ? activeWhenManual : false,
  });
  if (manual && tab.id) {
    manualFlows.set(tab.id, { returnTabId: sender?.tab?.id });
  }
  return { manual, tab };
}

async function ensureKoanLogin(record, sender) {
  if (await probeKoanLogin()) return { ok: true, loginStarted: false };
  if (koanLoginTask) return koanLoginTask;

  koanLoginTask = (async () => {
    const { manual, tab } = await openLoginTab(KOAN_PORTAL_URL, record, sender);
    try {
      const deadline = Date.now() + 90 * 1000;
      while (Date.now() < deadline) {
        await wait(1000);
        if (await probeKoanLogin()) {
          if (tab.id) {
            if (manual) await returnToDashboard(tab.id);
            else await chrome.tabs.remove(tab.id);
          }
          return { ok: true, loginStarted: true };
        }
      }
      throw new Error(manual
        ? "認証が完了していません。開いた認証画面でログインしてください。"
        : "KOANの自動ログインが完了しませんでした。開いた認証画面を確認してから、もう一度更新してください。");
    } finally {
      if (manual && tab.id) manualFlows.delete(tab.id);
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

async function ensureCleLogin(record, sender, force = false) {
  let tab = await findCleTab();
  if (!force && tab?.id && await cleApiReady(tab.id)) {
    await wait(1000);
    if (await cleApiReady(tab.id)) return { ok: true, loginStarted: false, tabId: tab.id };
  }
  if (cleLoginTask) return cleLoginTask;

  cleLoginTask = (async () => {
    const manual = !record?.enabled || !record.payload;
    if (!tab?.id) {
      ({ tab } = await openLoginTab(CLE_HOME_URL, record, sender));
    } else {
      if (manual) manualFlows.set(tab.id, { returnTabId: sender?.tab?.id });
      await chrome.tabs.update(tab.id, { url: CLE_HOME_URL, active: manual });
    }
    try {
      const deadline = Date.now() + 45 * 1000;
      while (Date.now() < deadline) {
        await wait(1000);
        if (tab.id && await cleApiReady(tab.id)) {
          await wait(1000);
          if (!await cleApiReady(tab.id)) continue;
          if (manual) {
            const flow = manualFlows.get(tab.id);
            manualFlows.delete(tab.id);
            if (flow?.returnTabId) {
              await chrome.tabs.update(flow.returnTabId, { active: true }).catch(() => {});
            }
          }
          return { ok: true, loginStarted: true, tabId: tab.id };
        }
      }
      throw new Error(manual
        ? "CLEの認証が完了していません。開いた認証画面でログインしてください。"
        : "CLEの自動再認証が完了しませんでした。CLEタブを確認してください。");
    } finally {
      if (manual && tab?.id) manualFlows.delete(tab.id);
      cleLoginTask = undefined;
    }
  })();
  return cleLoginTask;
}

async function authResponse(message, sender) {
  const record = await readAuthRecord();
  if (message.type === "auth-settings") return { ok: true, ...await readAuthSettings(record) };

  if (message.type === "auth-save") {
    const values = message.values || {};
    if (!values.enabled) {
      await clearAuthRecord();
      return { ok: true, configured: false, enabled: false, autoSubmit: true, mfaEnabled: false };
    }
    if (!values.id || !values.password) {
      if (!record?.payload) throw new Error("ID とパスワードを入力してください。");
    }
    const previous = record?.payload ? await decryptCredentials(record) : {};
    const totpSecret = values.mfaEnabled
      ? normalizeTotpSecret(values.totpSecret) || previous.totpSecret
      : "";
    if (values.mfaEnabled && !values.mfaConsent) {
      throw new Error("MFA 自動化のリスクを確認し、同意してください。");
    }
    if (values.mfaEnabled && !totpSecret) {
      throw new Error("TOTP シークレットを入力するか、QR画像から読み取ってください。");
    }
    if (totpSecret) decodeBase32(totpSecret);
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const payload = await encryptCredentials({
      id: values.id || previous.id,
      password: values.password || previous.password,
      totpSecret,
      mfaConsent: Boolean(values.mfaEnabled && totpSecret && values.mfaConsent),
    }, key);
    await writeAuthRecord({
      enabled: true,
      autoSubmit: true,
      mfaEnabled: Boolean(values.mfaEnabled && totpSecret && values.mfaConsent),
      key,
      payload,
    });
    return { ok: true, ...await readAuthSettings(await readAuthRecord()) };
  }

  if (message.type === "auth-ensure-koan") {
    return ensureKoanLogin(record, sender);
  }

  if (message.type === "auth-ensure-cle") {
    return ensureCleLogin(record, sender);
  }

  if (message.type === "auth-refresh-cle") {
    return ensureCleLogin(record, sender, true);
  }

  if (message.type === "auth-credentials") {
    if (new URL(sender.url || "").origin !== AUTH_ORIGIN) throw new Error("認証基盤以外には認証情報を渡しません。");
    if (!record?.enabled) return { ok: true };
    const credentials = await decryptCredentials(record);
    return { ok: true, credentials: { id: credentials.id, password: credentials.password }, autoSubmit: true };
  }

  if (message.type === "auth-submit-idp") {
    if (new URL(sender.url || "").origin !== AUTH_ORIGIN) throw new Error("認証基盤以外ではログイン送信を実行しません。");
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
    if (new URL(sender.url || "").origin !== MFA_ORIGIN) throw new Error("MFA 認証画面以外には認証コードを渡しません。");
    if (!record?.enabled || !record.mfaEnabled) return { ok: true };
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

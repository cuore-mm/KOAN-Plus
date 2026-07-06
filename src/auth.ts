import { sendMessage, isExtensionContext } from "./platform";

export type AuthSettings = {
  configured: boolean;
  enabled: boolean;
  autoSubmit: boolean;
  mfaEnabled: boolean;
  idHint: string;
};

type AuthResponse = AuthSettings & {
  ok: boolean;
  error?: string;
  loginStarted?: boolean;
  tabId?: number;
  shouldRefresh?: boolean;
  portalHtml?: string;
  portalUrl?: string;
  allowed?: boolean;
  retryAfterMs?: number;
};

async function sendAuthMessage(message: unknown): Promise<AuthResponse> {
  if (!isExtensionContext()) {
    throw new Error("自動ログイン設定はブラウザ拡張機能から開いてください。");
  }
  const response = await sendMessage<AuthResponse>(message);
  if (!response.ok) throw new Error(response.error || "自動ログイン設定の更新に失敗しました。");
  return response;
}

export function loadAuthSettings() {
  return sendAuthMessage({ type: "auth-settings" });
}

export function saveAuthSettings(values: {
  enabled: boolean;
  id: string;
  password: string;
  totpSecret: string;
  mfaConsent: boolean;
  mfaEnabled: boolean;
}) {
  return sendAuthMessage({ type: "auth-save", values });
}

export function deleteAuthSettings() {
  return sendAuthMessage({ type: "auth-delete" });
}

export function deleteMfaSettings() {
  return sendAuthMessage({ type: "auth-delete-mfa" });
}

export function ensureKoanLogin(options?: { requireTab?: boolean }) {
  return sendAuthMessage({
    type: "auth-ensure-koan",
    requireTab: Boolean(options?.requireTab),
  });
}

export function ensureCleLogin() {
  return sendAuthMessage({ type: "auth-ensure-cle" });
}

export function refreshCleLogin() {
  return sendAuthMessage({ type: "auth-refresh-cle" });
}

export async function claimStartupRefresh() {
  const response = await sendAuthMessage({ type: "auth-claim-startup-refresh" });
  return Boolean(response.shouldRefresh);
}

export async function claimDashboardRefresh() {
  const response = await sendAuthMessage({ type: "auth-claim-dashboard-refresh" });
  return {
    allowed: response.allowed !== false,
    retryAfterMs: Math.max(0, response.retryAfterMs || 0),
  };
}

export type MfaSecrets = {
  configured: boolean;
  totpSecret?: string;
  temporaryCancelCode?: string;
  error?: string;
};

export async function getSavedMfaSecrets(): Promise<MfaSecrets> {
  if (!isExtensionContext()) {
    throw new Error("拡張機能のコンテキスト以外から呼び出されています。");
  }
  const response = await sendMessage<MfaSecrets & { ok: boolean }>({ type: "auth-get-secrets" });
  if (!response.ok) throw new Error(response.error || "シークレットの取得に失敗しました。");
  return response;
}

export async function checkLoginStatus(): Promise<{ koanLoggedIn: boolean; cleLoggedIn: boolean }> {
  if (!isExtensionContext()) {
    return { koanLoggedIn: false, cleLoggedIn: false };
  }
  const response = await sendMessage<{
    ok: boolean;
    koanLoggedIn: boolean;
    cleLoggedIn: boolean;
    error?: string;
  }>({ type: "auth-check-login" });
  if (!response.ok) throw new Error(response.error || "ログイン状態の確認に失敗しました。");
  return { koanLoggedIn: response.koanLoggedIn, cleLoggedIn: response.cleLoggedIn };
}

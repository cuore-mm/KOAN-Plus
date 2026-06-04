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
};

async function sendAuthMessage(message: unknown): Promise<AuthResponse> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("自動ログイン設定はChrome拡張機能から開いてください。");
  }
  const response = await chrome.runtime.sendMessage(message) as AuthResponse;
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

export function ensureKoanLogin() {
  return sendAuthMessage({ type: "auth-ensure-koan" });
}

export function ensureCleLogin() {
  return sendAuthMessage({ type: "auth-ensure-cle" });
}

export function refreshCleLogin() {
  return sendAuthMessage({ type: "auth-refresh-cle" });
}

export type MfaSecrets = {
  configured: boolean;
  totpSecret?: string;
  temporaryCancelCode?: string;
  error?: string;
};

export async function getSavedMfaSecrets(): Promise<MfaSecrets> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("拡張機能のコンテキスト以外から呼び出されています。");
  }
  const response = await chrome.runtime.sendMessage({ type: "auth-get-secrets" }) as MfaSecrets & { ok: boolean };
  if (!response.ok) throw new Error(response.error || "シークレットの取得に失敗しました。");
  return response;
}

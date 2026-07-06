/**
 * ブラウザ検出と基本 API アクセス。
 * Chrome と Firefox の両方で `chrome` グローバルが利用可能なため、
 * 原則 `chrome.*` を使用し、callback API のみ Promise ラップする。
 */

export type ApiNamespace = "runtime" | "tabs" | "storage" | "scripting" | "downloads";

function getRawApi(): typeof chrome | undefined {
  // chrome グローバルは vite-env.d.ts で宣言済み
  if (typeof chrome !== "undefined") return chrome;
  return undefined;
}

const rawApi = getRawApi();

export function getApi() {
  if (!rawApi) throw new Error("ブラウザ拡張機能のコンテキスト以外から呼び出されています。");
  return rawApi;
}

/** 拡張機能コンテキストで実行されているか。 */
export function isExtensionContext(): boolean {
  return rawApi !== undefined &&
    typeof rawApi.runtime?.sendMessage === "function";
}

/** chrome と browser のどちらが使われているか。実装上は chrome 統一だが、検出用。 */
export function detectBrowser(): "chrome" | "firefox" | "unknown" {
  if (typeof chrome !== "undefined") {
    try {
      const url = chrome.runtime?.getURL("");
      if (url && url.startsWith("moz-extension://")) return "firefox";
      if (url && url.startsWith("chrome-extension://")) return "chrome";
    } catch { /* ignore */ }
    return "chrome"; // chrome namespace があるなら Chrome とみなす
  }
  return "unknown";
}

/**
 * callback ベースの chrome API を Promise にラップ。
 * 引数は `chrome.api.method(arg, callback)` 形式の呼び出しを想定。
 */
export function promisify<T>(
  fn: (...args: any[]) => void,
  args: unknown[],
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn(...args, (result: T) => {
      const error = chrome?.runtime?.lastError;
      if (error) {
        reject(new Error(error.message ?? String(error)));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * runtime API 互換ラッパー。
 * sendMessage は Chrome/Firefox とも Promise を返すため、薄いラッパーで統一。
 */

import { getApi } from "./browser";

type SendMessageResponse = Record<string, unknown> & { ok?: boolean; error?: string };

export async function sendMessage<T = SendMessageResponse>(message: unknown): Promise<T> {
  const api = getApi();
  if (!api.runtime?.sendMessage) {
    throw new Error("拡張機能のコンテキスト以外から呼び出されています。");
  }
  return api.runtime.sendMessage(message) as Promise<T>;
}

export function getManifest(): { version: string } {
  const api = getApi();
  return api.runtime?.getManifest?.() ?? { version: "0.0.0" };
}

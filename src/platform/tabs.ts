/**
 * tabs API 互換ラッパー。
 * Chrome の callback ベース API を Promise に統一し、
 * Firefox でも `chrome.tabs.*` 経由で動作させる。
 */

import { getApi } from "./browser";

export interface Tab {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  discarded?: boolean;
  lastAccessed?: number;
}

export interface CreateTabOptions {
  url?: string;
  active?: boolean;
}

export interface UpdateTabOptions {
  active?: boolean;
  url?: string;
}

export function create(options: CreateTabOptions): Promise<Tab> {
  const api = getApi();
  return new Promise((resolve, reject) => {
    api.tabs?.create(options, (tab: Tab) => {
      const error = api.runtime?.lastError;
      if (error) reject(new Error(error.message ?? String(error)));
      else resolve(tab);
    });
  });
}

export function update(tabId: number, options: UpdateTabOptions): Promise<Tab> {
  const api = getApi();
  return new Promise((resolve, reject) => {
    api.tabs?.update(tabId, options, (tab: Tab) => {
      const error = api.runtime?.lastError;
      if (error) reject(new Error(error.message ?? String(error)));
      else resolve(tab);
    });
  });
}

export function remove(tabId: number): Promise<void> {
  const api = getApi();
  return new Promise((resolve, reject) => {
    api.tabs?.remove(tabId, () => {
      const error = api.runtime?.lastError;
      if (error) reject(new Error(error.message ?? String(error)));
      else resolve();
    });
  });
}

/** tabs.onRemoved リスナー。Chrome/Firefox とも同期的に addListener/removeListener 可能。 */
export const onRemoved = {
  addListener(callback: (tabId: number) => void) {
    getApi().tabs?.onRemoved?.addListener(callback);
  },
  removeListener(callback: (tabId: number) => void) {
    getApi().tabs?.onRemoved?.removeListener(callback);
  },
};

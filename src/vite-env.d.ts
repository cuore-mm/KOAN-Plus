/// <reference types="vite/client" />

interface ChromeTab {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  discarded?: boolean;
  lastAccessed?: number;
}

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    sendMessage(message: unknown, callback: (response: unknown) => void): void;
    getManifest(): { version: string };
    getURL(path: string): string;
    id: string;
    lastError?: { message?: string };
  };
  tabs: {
    create(options: { url?: string; active?: boolean }, callback?: (tab: ChromeTab) => void): void;
    update(tabId: number, options: { active?: boolean; url?: string }, callback?: (tab: ChromeTab) => void): void;
    remove(tabId: number, callback?: () => void): void;
    query(queryInfo: Record<string, unknown>, callback: (tabs: ChromeTab[]) => void): void;
    get(tabId: number, callback: (tab: ChromeTab) => void): void;
    onRemoved: {
      addListener(callback: (tabId: number) => void): void;
      removeListener(callback: (tabId: number) => void): void;
    };
  };
  action: {
    onClicked: {
      addListener(callback: () => void): void;
    };
  };
  storage?: {
    session?: {
      get(keys: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      world?: "ISOLATED" | "MAIN";
      func?: (...args: unknown[]) => unknown;
      args?: unknown[];
    }): Promise<{ result?: unknown }[]>;
  };
  downloads: {
    download(options: {
      url: string;
      filename?: string;
      conflictAction?: string;
      saveAs?: boolean;
    }): Promise<number>;
    search(query: { id: number }): Promise<{ state?: string }[]>;
    setUiOptions(options: { enabled: boolean }): Promise<void>;
  };
  windows: {
    update(windowId: number, options: { focused: boolean }): Promise<void>;
  };
};

/** Firefox の `browser` global (Firefox のみ存在) */
declare const browser: typeof chrome;

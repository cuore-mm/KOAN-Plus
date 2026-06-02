chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "koan-fetch") return;

  (async () => {
    const requestUrl = new URL(message.request?.url);
    const method = message.request?.options?.method || "GET";
    if (requestUrl.origin !== "https://koan.osaka-u.ac.jp") {
      throw new Error("KOAN以外への通信は許可されていません。");
    }
    if (!["GET", "POST"].includes(method)) {
      throw new Error("許可されていない通信方式です。");
    }

    const tabs = await chrome.tabs.query({
      url: "https://koan.osaka-u.ac.jp/*",
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
      throw new Error("KOANをログイン済みのタブで開いてから取得してください。");
    }

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (request) => {
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
              ? "KOANの応答が15秒以内に返りませんでした。KOANタブを再読み込みして再試行してください。"
              : `KOANタブ内の取得に失敗しました: ${error?.message || String(error)}`,
          );
        } finally {
          clearTimeout(timeout);
        }
      },
      args: [message.request],
    });
    if (!execution.result) {
      throw new Error("KOANタブから応答を取得できませんでした。");
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

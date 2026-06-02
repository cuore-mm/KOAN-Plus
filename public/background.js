chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("public/background.js", "utf8");
const transport = source.slice(source.lastIndexOf("  const targets = {"), source.lastIndexOf("});"));
const timeoutSource = source.slice(source.indexOf("async function withTimeout("), source.indexOf("async function tabExists("));
const run = new Function("chrome", "message", "sender", "sendResponse", "requireExtensionPageSender", "waitForTabComplete", "KOAN_PORTAL_URL", "MAX_CLE_RESPONSE_TEXT_LENGTH", `${timeoutSource}\n${transport}`);
const url = "https://koan.osaka-u.ac.jp/campusweb/campussquare.do";
function harness(tabs = [{ id: 1, status: "loading" }], execute) {
  const chrome = { tabs: { query: vi.fn(async () => tabs), create: vi.fn(async () => ({ id: 3 })), remove: vi.fn(async () => {}) }, scripting: { executeScript: vi.fn(execute || (async () => [{ result: { ok: true, status: 200, text: "fixture", url } }])) } };
  const ready = vi.fn(async () => {});
  const start = (request = { url }, tabId = 1) => new Promise(resolve => run(chrome, { type: "koan-fetch", request, tabId }, {}, resolve, () => {}, ready, url, 1024));
  return { chrome, ready, start };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("KOAN tab transport", () => {
  it("starts before document_idle and isolates fetch from the host page", async () => {
    const { chrome, start } = harness();
    expect(await start()).toMatchObject({ ok: true, tabId: 1 });
    expect(chrome.scripting.executeScript.mock.calls[0][0]).toMatchObject({ injectImmediately: true, world: "ISOLATED" });
  });
  it("recovers from a frozen pinned tab without focusing or reloading the user's tab", async () => {
    const { chrome, start } = harness([{ id: 1, frozen: true }, { id: 2, status: "complete" }]);
    expect(await start()).toMatchObject({ ok: true, tabId: 2 });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it("creates a background context when all tabs are unavailable", async () => {
    const { chrome, ready, start } = harness([{ id: 1, discarded: true }]);
    expect(await start()).toMatchObject({ ok: true, tabId: 3 });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url, active: false });
    expect(ready).toHaveBeenCalledWith(3, 7000);
  });
  it("bounds a stalled renderer and never blindly resends a Web Flow POST", async () => {
    vi.useFakeTimers();
    const { chrome, start } = harness(undefined, () => new Promise(() => {}));
    const result = start({ url, options: { method: "POST", body: "_eventId=display" } });
    await vi.advanceTimersByTimeAsync(21001);
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining("応答しませんでした") });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
  it("does not send a POST if injection resumes after its deadline", async () => {
    const { chrome, start } = harness();
    await start();
    const { func } = chrome.scripting.executeScript.mock.calls[0][0];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(func({ url, options: { method: "POST" } }, "KOAN", 1024, Date.now() - 1)).rejects.toThrow("開始期限");
    expect(fetch).not.toHaveBeenCalled();
  });
});

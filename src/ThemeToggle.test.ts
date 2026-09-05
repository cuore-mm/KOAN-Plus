import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTheme, saveTheme } from "./ThemeToggle";
import { clearStorageDiagnostics, getStorageDiagnostics } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  clearStorageDiagnostics();
});

describe("theme storage", () => {
  it("falls back to light when localStorage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(loadTheme()).toBe("light");
    const readDiagnostics = getStorageDiagnostics();
    expect(readDiagnostics[readDiagnostics.length - 1]).toMatchObject({ kind: "read" });
  });

  it("reports a failed write without throwing", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(saveTheme("dark")).toBe(false);
    const writeDiagnostics = getStorageDiagnostics();
    expect(writeDiagnostics[writeDiagnostics.length - 1]).toMatchObject({ kind: "write" });
  });
});

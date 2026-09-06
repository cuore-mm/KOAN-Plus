import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backgroundSource = readFileSync(
  resolve(process.cwd(), "public/background.js"),
  "utf8",
);

describe("background service-worker contracts", () => {
  it("keeps MFA cancellation extension-only and session-backed", () => {
    expect(backgroundSource).toContain('"auth-mfa-cancel-auto-tab",');
    expect(backgroundSource).toMatch(
      /if \(message\.type === "auth-mfa-cancel-auto-tab"\) \{[\s\S]*?Number\.isInteger\(message\.tabId\)/,
    );
    expect(backgroundSource).toMatch(
      /status: "cancelled"[\s\S]*?currentPendingMfa\?\.tabId === tabId\) await clearPendingMfa\(\)/,
    );
    expect(backgroundSource).toMatch(/flow\?\.status === "pending"/);
  });

  it("caps CLE response bytes before returning response.text", () => {
    expect(backgroundSource).toContain("MAX_CLE_RESPONSE_TEXT_LENGTH");
    expect(backgroundSource).toContain('headers.get("content-length")');
    expect(backgroundSource).toContain("response.body.getReader?.()");
    expect(backgroundSource).toContain("totalBytes > maxResponseTextLength");
    expect(backgroundSource).toContain("await reader.cancel()");
    expect(backgroundSource).toMatch(
      /if \(totalBytes > maxResponseTextLength\) \{\s*await reader\.cancel\(\)\.catch\(\(\) => \{\}\);\s*controller\.abort\(\);/,
    );
  });
});

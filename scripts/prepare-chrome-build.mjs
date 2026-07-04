import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, "..", "dist-chrome");

// Chrome 用出力から Firefox 用 manifest を削除
await rm(join(distDir, "manifest.firefox.json"), { force: true });

console.log(`Prepared Chrome build: ${distDir}`);

import { copyFile, rm, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(projectRoot, "dist-firefox");
const srcManifest = join(distDir, "manifest.firefox.json");
const dstManifest = join(distDir, "manifest.json");

// manifest.firefox.json を manifest.json としてコピー
await copyFile(srcManifest, dstManifest);

// 元の manifest.firefox.json と manifest.chrome.json が残っていれば削除
for (const name of ["manifest.firefox.json", "manifest.chrome.json"]) {
  try {
    await access(join(distDir, name));
    await rm(join(distDir, name), { force: true });
  } catch {
    // 存在しなくても無視
  }
}

console.log(`Prepared Firefox build: ${dstManifest}`);

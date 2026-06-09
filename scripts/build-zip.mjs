import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(projectRoot, "dist");
const outputPath = join(projectRoot, "koan-plus.zip");

await rm(outputPath, { force: true });

async function collectFiles(directory) {
  const files = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectFiles(path));
    } else if (entry.isFile()) {
      const archivePath = relative(distDir, path).split(sep).join("/");
      files[archivePath] = new Uint8Array(await readFile(path));
    }
  }
  return files;
}

const files = await collectFiles(distDir);
await writeFile(outputPath, zipSync(files, { level: 9 }), { flag: "wx" });
console.log(`Created ${outputPath} with ${Object.keys(files).length} files`);

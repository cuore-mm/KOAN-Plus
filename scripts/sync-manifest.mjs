import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// package.json を読み込む
const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const { version, description } = pkg;

// manifest.json (開発用) のバージョンを更新
const devManifestPath = join(projectRoot, "manifest.json");
const devManifest = JSON.parse(await readFile(devManifestPath, "utf8"));
devManifest.version = version;
await writeFile(devManifestPath, JSON.stringify(devManifest, null, 2) + "\n");

// public/manifest.json (本番用) のバージョンと説明文を更新
const prodManifestPath = join(projectRoot, "public/manifest.json");
const prodManifest = JSON.parse(await readFile(prodManifestPath, "utf8"));
prodManifest.version = version;
prodManifest.description = description;
await writeFile(prodManifestPath, JSON.stringify(prodManifest, null, 2) + "\n");

console.log(`Synced version ${version} and description to manifest files.`);

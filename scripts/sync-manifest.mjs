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

// public/manifest.json (Chrome 本番用) のバージョンと説明文を更新
const chromeManifestPath = join(projectRoot, "public/manifest.json");
const chromeManifest = JSON.parse(await readFile(chromeManifestPath, "utf8"));
chromeManifest.version = version;
chromeManifest.description = description;
await writeFile(chromeManifestPath, JSON.stringify(chromeManifest, null, 2) + "\n");

// public/manifest.firefox.json (Firefox 用) のバージョンと説明文を更新
const firefoxManifestPath = join(projectRoot, "public/manifest.firefox.json");
const firefoxManifest = JSON.parse(await readFile(firefoxManifestPath, "utf8"));
firefoxManifest.version = version;
firefoxManifest.description = description;
await writeFile(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2) + "\n");

console.log(`Synced version ${version} and description to manifest files.`);

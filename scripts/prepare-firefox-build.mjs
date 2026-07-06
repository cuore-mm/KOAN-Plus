import { copyFile, rm, access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(projectRoot, "dist-firefox");
const srcManifest = join(distDir, "manifest.firefox.json");
const dstManifest = join(distDir, "manifest.json");

// ---------- step 1: copy Firefox source manifest ----------
await copyFile(srcManifest, dstManifest);

// ---------- step 2: validate the result ----------
const raw = await readFile(dstManifest, "utf-8");
const manifest = JSON.parse(raw);

const errors = [];

// 2a. background: Firefox では service_worker 不可、scripts 必須
if (manifest.background?.service_worker) {
  errors.push(
    "background.service_worker is not supported by Firefox. Use background.scripts instead."
  );
}
if (!manifest.background?.scripts || manifest.background.scripts.length === 0) {
  errors.push(
    "background.scripts is required by Firefox. Add at least one script path."
  );
}

// 2b. browser_specific_settings.gecko.id 必須
if (!manifest.browser_specific_settings?.gecko?.id) {
  errors.push(
    "browser_specific_settings.gecko.id is required for Firefox add-ons."
  );
}

// 2c. Firefox 非対応 permission をチェック（必要に応じて追加）
const firefoxIncompatiblePermissions = ["downloads.ui"];
const declaredPermissions = manifest.permissions || [];
for (const perm of firefoxIncompatiblePermissions) {
  if (declaredPermissions.includes(perm)) {
    errors.push(
      `Permission "${perm}" is not supported by Firefox. Remove it from the Firefox manifest.`
    );
  }
}

// 2d. host_permissions が配列であること（空でも可、存在自体は任意）
if (manifest.host_permissions !== undefined && !Array.isArray(manifest.host_permissions)) {
  errors.push("host_permissions must be an array.");
}

if (errors.length > 0) {
  const message = `Firefox manifest validation failed:\n${errors.map((e) => `  • ${e}`).join("\n")}`;
  console.error(message);
  process.exit(1);
}

// ---------- step 3: clean up extra manifest variants ----------
for (const name of ["manifest.firefox.json", "manifest.chrome.json"]) {
  try {
    await access(join(distDir, name));
    await rm(join(distDir, name), { force: true });
  } catch {
    // 存在しなくても無視
  }
}

console.log(`✅ Prepared Firefox build: ${dstManifest}`);
console.log("   Firefox manifest validation passed.");

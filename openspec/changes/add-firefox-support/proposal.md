## Why

KOAN Plus は現在 Chrome MV3 前提の拡張機能として実装されており、Firefox では manifest、background、WebExtensions API の差異により主要機能がそのまま動作しない可能性が高い。Firefox 利用者にも同じローカル専用ダッシュボード体験を提供しつつ、既存 Chrome 版の安定性を維持するため、ブラウザ互換方針を明確化して段階的に対応する。

## What Changes

- Chrome と Firefox の両方で拡張機能をビルド・読み込みできる構成を追加する。
- Chrome 固有 API 呼び出しを整理し、runtime、tabs、storage、scripting、downloads などの差異を吸収する互換レイヤーを導入する。
- Firefox 用 manifest を用意し、background、permission、Gecko 固有設定を Firefox の WebExtensions 要件に合わせる。
- `chrome.scripting.executeScript({ world: "MAIN" })`、`chrome.storage.session`、`chrome.downloads.setUiOptions` など Firefox 非互換または差異の大きい箇所に代替経路または feature detection を設計する。
- Firefox での初期 MVP は、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE の基本取得を優先し、自動ログイン、MFA 自動登録、CLE 資料ダウンロードなど page world 依存が強い機能は段階的に安定化する。
- Chrome 版の既存挙動を回帰させないため、Chrome 用ビルドと Firefox 用ビルドを分離して検証できるようにする。

## Capabilities

### New Capabilities
- `browser-extension-compatibility`: Chrome と Firefox の両方で KOAN Plus 拡張機能をビルド、読み込み、主要ワークフローを実行できる互換性要件を扱う。

### Modified Capabilities
- なし。既存 OpenSpec capability はまだ定義されていない。

## Impact

- 影響対象: `public/manifest.json`, root `manifest.json`, `public/background.js`, `public/auth-content.js`, `src/App.tsx`, `src/auth.ts`, `src/vite-env.d.ts`, `scripts/sync-manifest.mjs`, `scripts/build-zip.mjs`, `vite.config.ts`, `package.json`。
- 新規追加候補: `src/platform/` 配下のブラウザ互換 API、ブラウザ別 manifest、Firefox 用 background/bridge、Firefox packaging/lint scripts。
- WebExtensions API 差異: `chrome.*` / `browser.*`、callback / Promise、`background.service_worker` / `background.scripts`、`chrome-extension:` / `moz-extension:`、`storage.session`、`downloads.setUiOptions`、`scripting.executeScript` の world 指定。
- 検証対象: `npm run build` による既存 Chrome 回帰、Chrome での手動ロード、Firefox `about:debugging` での一時ロード、必要に応じた `web-ext lint` / `web-ext build`。

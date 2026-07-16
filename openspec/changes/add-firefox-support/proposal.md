## Why

KOAN Plus を Firefox 最新版と現行 ESR でも利用・配布できるようにする。調査と実機確認の結果、対象 Firefox は既存の `chrome.*` 互換 API、`storage.session`、`scripting.executeScript({ world: "MAIN" })` をサポートしており、広範な互換レイヤーや代替実装は不要と分かった。一方、Firefox 固有 manifest、配布用 package、`moz-extension:` の sender 検証は必要である。Firefox 対応に直接必要な差分だけを残し、Chrome 回帰リスクと保守コストを最小化する。

## What Changes

- Chrome 用 `public/manifest.json` を維持し、Firefox 用 `public/manifest.firefox.json` を用意する。
- Firefox manifest は `background.scripts`、固定 Gecko ID、Firefox 対応 permissions を使用し、`downloads.ui` を含めない。
- 既存の `npm run build` / `npm run zip` を Chrome 用として維持し、Firefox 用に `npm run build:firefox` / `npm run zip:firefox` だけを追加する。
- Firefox 用成果物を `dist-firefox/` に生成し、配布可能な ZIP package を生成する。
- 拡張ページ sender 検証で `moz-extension:` と Firefox 内部 UUID を正しく扱う。
- Firefox ESR 140 以降で既にサポートされる API のための独自互換レイヤー、`storage.session` fallback、page bridge は導入しない。
- 既に追加された任意の互換実装と重複 build command を戻し、必要最小限の差分へ整理する。
- Firefox 最新版と現行 ESR で、オンボーディング、KOAN/CLE 取得、自動ログイン、MFA、資料ダウンロードを既存実装のまま検証する。必須ワークフローに差異が見つかった場合は完了を保留し、本change内で対象箇所だけを修正して再検証する。

## Capabilities

### New Capabilities
- `browser-extension-compatibility`: Chrome 版を維持しながら、Firefox 向け成果物と配布 package を生成し、既存主要ワークフローを実行できることを扱う。

### Modified Capabilities
- なし。既存 OpenSpec capability はまだ定義されていない。

## Impact

- 必須変更対象: `public/manifest.firefox.json`、`public/background.js` の sender 検証、`scripts/sync-manifest.mjs`、Firefox build/package に必要な最小スクリプト、`package.json`。
- 整理対象: `src/platform/`、互換レイヤー導入に伴う `src/App.tsx` / `src/auth.ts` / `src/vite-env.d.ts` の変更、`storage.session` fallback、重複する Chrome 用追加 command、不要な manifest 検証。
- 検証対象: Chrome build/package、Firefox build/package、`web-ext lint`、Firefox 最新版と現行 ESR での主要ワークフロー、sender検証のfocused harness。
- ドキュメント対象: `docs/browser-support.md` のbuild/package手順、対象version、MAIN world分類、実機確認結果。
- 範囲外: AMO への提出、署名、公開手続き、旧 ESR 対応、Safari 対応。

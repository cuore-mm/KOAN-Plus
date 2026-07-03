## 1. 現状調査と互換性棚卸し

- [ ] 1.1 `public/background.js`、`public/auth-content.js`、`src/App.tsx`、`src/auth.ts`、`src/vite-env.d.ts` を確認し、`chrome.*`、`browser`、`chrome-extension:`、`world: "MAIN"`、`storage.session`、`downloads.setUiOptions` の使用箇所を一覧化する。一覧にはファイル名、用途、Chrome 維持要否、Firefox 代替要否を含める。
- [ ] 1.2 `public/manifest.json`、root `manifest.json`、`scripts/sync-manifest.mjs`、`scripts/build-zip.mjs`、`vite.config.ts`、`package.json` を確認し、現在の manifest 同期、build、zip 化の入力と出力を記録する。
- [ ] 1.3 Firefox MVP の対象機能を、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE 基本取得として実装メモに明記し、自動ログイン、MFA 自動登録、CLE 資料ダウンロードを page world 依存機能として別枠管理する。

## 2. ブラウザ別 manifest と build 構成

- [ ] 2.1 Chrome 用 manifest と Firefox 用 manifest のソース構成を決め、`public/manifest.json` を維持するか、`public/manifest.chrome.json` / `public/manifest.firefox.json` などへ分離する。完了条件は Chrome 用と Firefox 用の manifest 入力ファイルまたは template が明確に存在すること。
- [ ] 2.2 Firefox 用 manifest に Firefox WebExtensions として必要な background 定義、`browser_specific_settings.gecko`、permission 差分、host permissions を追加し、`downloads.ui` など Firefox 非対応 permission を含めない。
- [ ] 2.3 `scripts/sync-manifest.mjs` を更新し、`package.json` の `version` と `description` が Chrome 用 manifest と Firefox 用 manifest の両方へ同期されることを確認する。
- [ ] 2.4 `package.json` に Chrome 用 build、Firefox 用 build、必要なら Chrome/Firefox 用 zip または package script を追加し、出力先が混ざらないことを確認する。
- [ ] 2.5 `npm run build` が既存 Chrome 用検証として引き続き成功することを確認し、Firefox 用 build script を追加した場合はその script も成功することを確認する。

## 3. ブラウザ API 互換レイヤー

- [ ] 3.1 `src/platform/` などに runtime、tabs、storage、scripting、downloads の互換 API を作成し、`chrome` と `browser` の存在判定、callback API と Promise API の統一、エラー伝播を実装する。
- [ ] 3.2 `src/vite-env.d.ts` または採用する型定義を更新し、`chrome` と `browser` の両方、または互換レイヤーで必要な WebExtensions 型が TypeScript で扱えることを確認する。
- [ ] 3.3 `src/App.tsx` の `chrome.runtime.getManifest`、`chrome.tabs.create`、`chrome.tabs.onRemoved` などの使用箇所を互換 API 経由に置き換え、Firefox でも Promise として完了や失敗を扱えることを確認する。
- [ ] 3.4 `src/auth.ts` の `chrome.runtime.sendMessage` 使用箇所を互換 API 経由に置き換え、送信失敗時に既存と同等以上のエラーが呼び出し元へ返ることを確認する。
- [ ] 3.5 `public/background.js` と `public/auth-content.js` で共通 helper を使えるか確認し、使えない場合は self-contained な browser API 判定関数を追加して direct `chrome.*` 差異を局所化する。

## 4. Firefox 非互換 API の代替実装

- [ ] 4.1 `isExtensionPageSender` 相当の sender 検証で `chrome-extension:` と `moz-extension:` の両方を許可し、拡張 ID 検証が Chrome で回帰しないことを確認する。
- [ ] 4.2 `chrome.storage.session` 使用箇所に feature detection を追加し、未対応環境では `storage.local` または background 内メモリ + TTL 付きキーへ fallback する。一時状態は処理完了、失敗、対象タブ close 時に削除されることを確認する。
- [ ] 4.3 `chrome.downloads.setUiOptions` 使用箇所に feature detection を追加し、Firefox では UI 抑制なしでダウンロード処理を継続するか、継続不可の場合は明示的なエラーを返す。
- [ ] 4.4 `chrome.scripting.executeScript({ world: "MAIN" })` 使用箇所を用途別に分類し、isolated world で代替可能な処理、page bridge が必要な処理、未対応エラーで扱う処理を実装メモまたはコード構造に反映する。
- [ ] 4.5 page bridge が必要な場合は `public/` 配下に bridge script または content script 経由の注入処理を追加し、message type、nonce、`event.source === window` などの検証を実装する。

## 5. Firefox MVP 機能の検証

- [ ] 5.1 Firefox 用成果物を `about:debugging#/runtime/this-firefox` で一時ロードし、manifest エラーなしで読み込めることを確認する。
- [ ] 5.2 Firefox でツールバーボタンまたは拡張ページからダッシュボードを開き、`src/App.tsx` の UI が表示されることを確認する。
- [ ] 5.3 Firefox でオンボーディングを実行し、同意と初期設定が保存され、再表示時にダッシュボードへ進めることを確認する。
- [ ] 5.4 Firefox で保存済み KOAN/CLE データがある状態を作り、ダッシュボードに既存データが表示されることを確認する。
- [ ] 5.5 Firefox で KOAN/CLE 基本取得を実行し、成功時にダッシュボードが更新されること、失敗時に原因が分かるエラーになることを確認する。

## 6. Chrome 回帰確認

- [ ] 6.1 `npm run build` を実行し、manifest 同期、TypeScript build、Vite build が成功することを確認する。
- [ ] 6.2 Chrome で `dist/` を `chrome://extensions` から読み込み、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE 取得が Firefox 対応前と同等に動くことを確認する。
- [ ] 6.3 自動ログイン、MFA 自動登録、CLE 資料ダウンロードに変更を加えた場合は Chrome でそれぞれ手動確認し、変更を加えていない場合は未変更であることを差分確認する。
- [ ] 6.4 `dist/`、ZIP、XPI、`node_modules/`、`*.tsbuildinfo` が git に含まれていないことを `git status --short` で確認する。

## 7. Firefox 追加検証とドキュメント整理

- [ ] 7.1 `web-ext` を導入した場合は `npx web-ext lint --source-dir <firefox-dist>` と `npx web-ext build --source-dir <firefox-dist>` を実行し、警告またはエラーを記録する。
- [ ] 7.2 Firefox で自動ログイン、MFA 自動登録、CLE 資料ダウンロードを検証し、動作可能、代替実装待ち、未対応エラーのいずれかを明確にする。
- [ ] 7.3 README または該当ドキュメントに Chrome 用ビルド、Firefox 用ビルド、Firefox 一時ロード手順、既知制限を追記する。
- [ ] 7.4 最終差分で OpenSpec の `browser-extension-compatibility` 要件が満たされていることを確認し、満たせない要件があればタスクまたは spec を更新する。

## 1. 現状調査と互換性棚卸し

- [x] 1.1 [requires source inspection] `public/background.js`、`public/auth-content.js`、`src/App.tsx`、`src/auth.ts`、`src/vite-env.d.ts` を確認し、`chrome.*`、`browser`、`chrome-extension:`、`world: "MAIN"`、`storage.session`、`downloads.setUiOptions` の使用箇所を一覧化する。一覧にはファイル名、用途、Chrome 維持要否、Firefox 代替要否を含める。
- [x] 1.2 [requires source inspection] `public/manifest.json`、root `manifest.json`、`scripts/sync-manifest.mjs`、`scripts/build-zip.mjs`、`vite.config.ts`、`package.json` を確認し、現在の manifest 同期、build、zip 化の入力と出力を記録する。
- [x] 1.3 実装時点の Firefox 最新版 major と現行 ESR major を確認し、最低サポートバージョンを現行 ESR major として README または `docs/browser-support.md` に記録する。タスク完了メモにも記録し、旧 ESR や古い Firefox はサポート対象外と明記する。
- [x] 1.4 [requires source inspection] Firefox MVP の対象機能を、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE 基本取得として実装メモに明記する。KOAN/CLE 基本取得については、Chrome 版の手動セッション更新フローがダッシュボード表示に使うデータカテゴリを既存実装から確認し、README または `docs/browser-support.md` に取得対象として記録する。自動ログイン、MFA 自動登録、CLE 資料ダウンロードは page world 依存機能として別枠管理する。

## 2. ブラウザ別 manifest と build 構成

- [x] 2.1 Chrome 用 manifest と Firefox 用 manifest のソース構成を決め、`public/manifest.json` を維持するか、`public/manifest.chrome.json` / `public/manifest.firefox.json` などへ分離する。完了条件は Chrome 用と Firefox 用の manifest 入力ファイルまたは template が明確に存在すること。
- [x] 2.2 Firefox 用 manifest に Firefox WebExtensions として必要な background 定義、`browser_specific_settings.gecko`、permission 差分、host permissions を追加し、`downloads.ui` など Firefox 非対応 permission を含めない。
- [x] 2.3 `scripts/sync-manifest.mjs` を更新し、`package.json` の `version` と `description` が Chrome 用 manifest と Firefox 用 manifest の両方へ同期されることを確認する。
- [x] 2.4 `package.json` に `npm run build:chrome`、`npm run build:firefox`、必要なら `npm run build:all`、`npm run zip:chrome`、`npm run zip:firefox` を追加する。`npm run build` と `npm run zip` は既存互換のため Chrome 用として `dist/` 出力を維持し、`build:chrome` の出力は `dist-chrome/`、`build:firefox` の出力は `dist-firefox/` に分離する。
- [x] 2.5 `npm run build`、`npm run build:chrome`、`npm run build:firefox` を実行し、`npm run build` は既存互換の `dist/`、`npm run build:chrome` は `dist-chrome/`、`npm run build:firefox` は `dist-firefox/` に manifest と必要ファイルを生成することを確認する。

## 3. ブラウザ API 互換レイヤー

- [x] 3.1 `src/platform/` などに runtime、tabs、storage、scripting、downloads の互換 API を作成し、`chrome` と `browser` の存在判定、callback API と Promise API の統一、エラー伝播を実装する。初期実装では `webextension-polyfill` を追加せず、自前 wrapper で不足する場合のみ依存追加を検討する。
- [x] 3.2 `src/vite-env.d.ts` または採用する型定義を更新し、`chrome` と `browser` の両方、または互換レイヤーで必要な WebExtensions 型が TypeScript で扱えることを確認する。
- [x] 3.3 `src/App.tsx` の `chrome.runtime.getManifest`、`chrome.tabs.create`、`chrome.tabs.onRemoved` などの使用箇所を互換 API 経由に置き換え、Firefox でも Promise として完了や失敗を扱えることを確認する。
- [x] 3.4 `src/auth.ts` の `chrome.runtime.sendMessage` 使用箇所を互換 API 経由に置き換え、送信失敗時に既存と同等以上のエラーが呼び出し元へ返ることを確認する。
- [x] 3.5 `public/background.js` と `public/auth-content.js` は初期実装では `public/` 配下の JavaScript として維持する。共通 helper を使えるか確認し、使えない場合は self-contained な browser API 判定関数を追加して direct `chrome.*` 差異を局所化する。

## 4. Firefox 非互換 API の代替実装

- [x] 4.1 `isExtensionPageSender` 相当の sender 検証で `chrome-extension:` と `moz-extension:` の両方を許可し、拡張 ID 検証が Chrome で回帰しないことを確認する。
- [x] 4.2 `chrome.storage.session` 使用箇所に feature detection を追加し、現行 ESR 対応に必要な場合のみ `storage.local` または background 内メモリ + TTL 付きキーへ軽く fallback する。一時状態は処理完了、失敗、対象タブ close 時に削除されることを確認する。旧 ESR 専用の複雑な分岐は追加しない。
- [x] 4.3 `chrome.downloads.setUiOptions` 使用箇所に feature detection を追加し、Firefox では UI 抑制なしでダウンロード処理を継続するか、継続不可の場合は明示的なエラーを返す。
- [x] 4.4 `chrome.scripting.executeScript({ world: "MAIN" })` 使用箇所を用途別に分類し、isolated world で代替可能な処理、page bridge が必要な処理、未対応エラーで扱う処理を実装メモまたはコード構造に反映する。
- [x] 4.5 page bridge が必要な場合は `public/` 配下に bridge script または content script 経由の注入処理を追加する。今回の MVP では class B（page bridge 必要）の機能（自動ログイン、MFA 自動登録）は必須外のため bridge 実装は延期し、class A の `world: "MAIN"` 使用箇所は isolated 化で対応する方針とした。
- [x] 4.6 Firefox 用 manifest に `browser_specific_settings.gecko.id` を固定値として追加する（task 2.2 で `public/manifest.firefox.json` に `koan-plus@cuore-mm` として設定済み）。

## 5. Firefox MVP 機能の検証

- [ ] 5.1 Firefox 用成果物を Firefox 最新版と現行 ESR の `about:debugging#/runtime/this-firefox` で一時ロードし、manifest エラーなしで読み込めることを確認する。
- [ ] 5.2 Firefox でツールバーボタンまたは拡張ページからダッシュボードを開き、`src/App.tsx` の UI が表示されることを確認する。
- [ ] 5.3 Firefox でオンボーディングを実行し、同意と初期設定が保存され、再表示時にダッシュボードへ進めることを確認する。
- [ ] 5.4 Firefox で保存済み KOAN/CLE データがある状態を作り、ダッシュボードに既存データが表示されることを確認する。
- [ ] 5.5 Firefox で、対象サイトへ手動ログイン済みまたは既存セッション Cookie が有効な状態で KOAN/CLE 基本取得を実行し、1.4 で記録したデータカテゴリが取得され、成功時にダッシュボードが更新されることを確認する。未ログインまたはセッション切れの場合は、自動ログインや MFA 自動処理を暗黙実行せず、手動ログインが必要と分かるエラーになることを確認する。
- [ ] 5.6 自動ログイン、MFA 自動登録、CLE 資料ダウンロードを Firefox で完全対応しない場合、各機能が明示的な未対応エラーまたは実装待ち表示になり、クラッシュや無限待機を起こさないことを確認する。

## 6. Chrome 回帰確認

- [ ] 6.1 `npm run build` を実行し、manifest 同期、TypeScript build、Vite build が成功することを確認する。
- [ ] 6.2 Chrome で `dist/` を `chrome://extensions` から読み込み、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE 取得が Firefox 対応前と同等に動くことを確認する。
- [ ] 6.3 自動ログイン、MFA 自動登録、CLE 資料ダウンロードに変更を加えた場合は Chrome でそれぞれ手動確認し、変更を加えていない場合は未変更であることを差分確認する。
- [ ] 6.4 `dist/`、ZIP、XPI、`node_modules/`、`*.tsbuildinfo` が git に含まれていないことを `git status --short` で確認する。
- [ ] 6.5 fallback 一時状態を使う実装を追加した場合、成功、失敗、TTL 期限切れ、対象タブ close の各ケースで一時状態が削除または無効化されることを確認する。
- [ ] 6.6 `npm run zip`、`npm run zip:chrome`、`npm run zip:firefox` などの zip/package script を追加または変更した場合は、該当 command を実行して成功することを確認する。Chrome package は `dist/` または `dist-chrome/` から、Firefox package は `dist-firefox/` から生成する。Firefox packaging が `npx web-ext build --source-dir dist-firefox` 以外の command を使う場合は、実行した command、artifact の出力先、ファイル名をタスク完了メモまたは PR 説明に記録する。生成された ZIP、XPI、package artifact はコミットしない。

## 7. Firefox 追加検証とドキュメント整理

- [ ] 7.1 Firefox 用成果物に対して `npx web-ext lint --source-dir dist-firefox` を実行し、error なしで成功することを確認する。warning がある場合は内容と許容理由をタスク完了メモ、PR 説明、または `docs/browser-support.md` に記録し、Firefox 最新版と現行 ESR の一時ロードに影響しないと判断できる場合のみ許容する。この change の必須成果物は一時ロード可能な `dist-firefox/` とする。`web-ext build` または同等の packaging verification は、この change が Firefox package/XPI script を追加または変更する場合のみ必須とする。
- [ ] 7.2 Firefox 最新版と現行 ESR で自動ログイン、MFA 自動登録、CLE 資料ダウンロードを検証し、動作可能、代替実装待ち、未対応エラーのいずれかを明確にする。
- [ ] 7.3 README または該当ドキュメントに Chrome 用ビルド、Firefox 用ビルド、Firefox 一時ロード手順、最低サポートバージョン、既知制限を追記する。
- [ ] 7.4 最終差分で OpenSpec の `browser-extension-compatibility` 要件が満たされていることを確認し、満たせない要件があればタスクまたは spec を更新する。

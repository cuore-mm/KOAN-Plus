# ブラウザ対応メモ

この文書は `openspec/changes/add-firefox-support` の task 1 で確認した、Firefox 対応の前提・棚卸し結果を記録する。

## サポート対象ブラウザ

- Chrome / Chromium 系: 現行 Chrome MV3 拡張としての動作を維持する。
- Firefox: Firefox 最新版と現行 Firefox ESR を対象にする。
- 最低サポートバージョン: **Firefox ESR 140**。
- 調査日: 2026-07-04。
- 根拠: Mozilla の Firefox ESR 140.12.0 release notes は 2026-06-16 提供開始として公開されており、2026-07-04 時点の現行 ESR major は 140。Firefox Release channel は 152 系が 2026-06-30 時点で公開されているため、実装時点の最新版 major は 152 として扱う。
- 旧 ESR や古い Firefox のための複雑な互換処理は入れない。ESR 140 で必要な軽い feature detection / fallback のみ持つ。

## Firefox MVP の対象範囲

Firefox MVP は以下を対象にする。

- ダッシュボード起動。
- オンボーディング。
- `localStorage` に保存済みの KOAN / CLE / 成績 / オンボーディングデータ表示。
- 既に認証済みの Firefox セッション、または利用者の手動ログイン済みセッションを前提にした KOAN/CLE 基本取得。

Firefox MVP の KOAN/CLE 基本取得に含めるデータカテゴリは、現行 Chrome の手動セッション更新フローに合わせる。

### KOAN 基本取得カテゴリ

`src/App.tsx` の `updateKoan` は `ensureKoanLogin()` 後に `refreshLight()` を呼び、`src/koan.ts` の `refreshLight()` は以下を取得・更新する。

- ポータル HTML / ログイン状態確認。
- 時間割: 当月時間割および必要に応じた 8 週間分の将来時間割。
- 履修授業。
- 休講・補講情報。
- 新着掲示。

以下は Firefox MVP の KOAN 基本取得には含めない。

- 掲示の全件同期 / ジャンル別深掘り取得（`refreshSnapshot()`）。
- 成績・単位取得（`refreshGrades()`）。
- 自動ログイン、MFA 自動化、page world のグローバル関数に依存する追加取得。

### CLE 基本取得カテゴリ

`src/App.tsx` の `updateCle` は `ensureCleLogin()` 後に `refreshCle()` を呼び、`src/cle.ts` の `refreshCle()` は以下を取得・更新する。

- コース一覧。
- 課題一覧。
- 課題ステータス。
- 未読メッセージ集計。
- 連絡事項。

以下は Firefox MVP の CLE 基本取得には含めない。

- CLE 資料一覧の深掘り取得。
- CLE 資料ファイルの個別 / 一括ダウンロード。
- 自動ログイン、MFA 自動化、page world のグローバル関数に依存する追加取得。

未ログインまたはセッション切れの場合は、自動ログインや MFA 自動処理を暗黙実行せず、手動ログインが必要であることを利用者に分かる形で返す。

## Chrome / WebExtensions API 使用箇所の棚卸し

### `public/background.js`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `chrome.action.onClicked`, `chrome.tabs.create`, `chrome.runtime.getURL` (`1-2`) | ツールバーボタンから `index.html` を開く | 維持 | `browser.action` / `browser.tabs` または `chrome` 互換 API で Promise 化 |
| `chrome.tabs.onRemoved` (`46-61`) | MFA 自動登録タブ、pending MFA、一時状態の cleanup | 維持 | Firefox でも同等 listener を使う。session fallback cleanup と合わせる |
| `isExtensionPageSender()` (`82-87`) | extension page sender 検証 | 維持 | `chrome-extension:` に加えて `moz-extension:` を許可 |
| `chrome.storage.session` (`281-381`, `814-837`) | MFA 自動登録タブ ID、MFA flow、pending MFA、startup/dashboard refresh claim | 維持 | ESR 140 での availability を feature detect。未対応時は軽い fallback を用意 |
| `chrome.tabs.*`, `chrome.windows.update` (`402-457`, `560-647`, `704-772`, `1021-1027`, `1332-1531`) | KOAN/CLE タブ探索、作成、更新、focus、削除、ログイン誘導、資料スキャン | 維持 | Promise ベース互換 API に寄せる |
| `chrome.downloads.download`, `chrome.downloads.search` (`459-471`, `1270-1275`) | CLE 資料ダウンロードと完了待ち | 維持 | Firefox でも download 自体は使う。filename / subdirectory 制約を検証 |
| `chrome.downloads.setUiOptions` (`1298-1319`) | 一括ダウンロード時の download UI 抑制 | 維持 | Firefox では存在しないため feature detection + no-op |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`479-542`) | CLE document DOM から添付ファイルを抽出 | 維持 | isolated world 代替または page bridge / 未対応エラー |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`672-698`) | CLE API ready probe を CLE タブ内 fetch で確認 | 維持 | tab 内 fetch 代替経路を検討。Firefox で world 指定不可なら isolated/script bridge |
| `chrome.scripting.executeScript` without `world` (`730-742`, `923-930`) | MFA 入力検出、MFA 登録完了確認 | 維持 | Firefox でも比較的移植しやすいが Promise/error handling を揃える |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`868-905`) | MFA 登録画面で `execSrvStatus` / form submit | 維持 | page world 依存。Firefox は button/form fallback または page bridge |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`1198-1223`) | IdP ログインで `LoginSubmit` / form submit | 維持 | page world 依存。Firefox は button/form fallback または page bridge |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`1383-1428`) | CLE file HEAD 相当をタブ内 fetch で実行 | 維持 | Firefox は isolated fetch 可否を検証し、必要なら bridge |
| `chrome.scripting.executeScript({ world: "MAIN" })` (`1531-1567`) | `koan-fetch` / `cle-fetch` のタブ内 fetch | 維持 | KOAN/CLE 基本取得の中心。Firefox MVP で最優先対応 |
| `chrome.runtime.onMessage` (`1246-1576`) | auth / CLE / KOAN message routing | 維持 | `browser.runtime` 互換または `chrome` Promise 互換で維持 |

### `public/auth-content.js`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `chrome.runtime.sendMessage` (`25-44`) | MFA 登録画面の「MFA登録に進む」操作依頼 | 維持 | `browser.runtime.sendMessage` 互換 |
| `chrome.runtime.sendMessage` (`64-86`) | IdP ログイン submit 依頼 | 維持 | `browser.runtime.sendMessage` 互換 |
| `chrome.runtime.sendMessage` (`134-153`, `164-170`) | CLE / IdP 認証情報取得と自動入力 | 維持 | Firefox MVP では必須外。最終対応では互換化 |
| `chrome.runtime.sendMessage` (`178-186`) | TOTP コード取得と入力 | 維持 | Firefox MVP では必須外。最終対応では互換化 |
| `chrome.runtime.sendMessage` (`194-217`, `256-292`) | MFA 自動登録状態確認、pending save、confirm save、tab close | 維持 | Firefox MVP では必須外。最終対応では互換化 |

### `src/App.tsx`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `(window as any).chrome.runtime.getManifest()` (`869-881`) | 問い合わせ URL に拡張 version と UA を付与 | 維持 | `browser.runtime.getManifest` または互換 helper |
| `chromeObj.runtime.sendMessage({ type: "auth-focus-pending-mfa" })` (`1010-1026`) | MFA 自動登録開始前の pending MFA tab focus | 維持 | Firefox MVP では必須外。互換 helper 化 |
| `chromeObj.tabs.create(..., callback)` (`1029-1097`) | MFA 自動登録用 background tab 作成、onRemoved、runtime callback | 維持 | Firefox では Promise 化必須 |
| `chromeObj.tabs.onRemoved.addListener/removeListener` (`1048-1084`) | MFA 自動登録タブ close 検知 | 維持 | Promise 化した tabs flow と組み合わせる |

### `src/auth.ts`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `chrome.runtime.sendMessage` (`21-27`) | auth settings / save / delete / ensure login 系の共通送信 | 維持 | runtime 互換 helper 化。エラーメッセージの「Chrome拡張機能」表記も汎用化 |
| `chrome.runtime.sendMessage` (`88-108`) | MFA secret 取得、ログイン状態確認 | 維持 | runtime 互換 helper 化 |

### `src/koan.ts`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `chrome.runtime.sendMessage({ type: "koan-fetch" })` (`359-375`) | KOAN タブ内 fetch を background 経由で実行 | 維持 | Firefox MVP の KOAN 基本取得に必須。runtime 互換 helper 化 |
| `refreshLight()` (`743-917`) | KOAN 基本取得: ポータル、時間割、履修授業、休講補講、新着掲示 | 維持 | Firefox MVP 対象 |
| `refreshSnapshot()` (`955-...`) | 掲示全件同期 | 維持 | Firefox MVP 対象外 |
| `refreshGrades()` (`1235-1261`) | 成績 / 単位取得 | 維持 | Firefox MVP 対象外 |

### `src/cle.ts`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `chrome.runtime.sendMessage({ type: "cle-fetch" })` (`314-327`) | CLE API fetch を background 経由で実行 | 維持 | Firefox MVP の CLE 基本取得に必須。runtime 互換 helper 化 |
| `chrome.runtime.sendMessage({ type: "cle-head-batch" })` (`527-...`) | 資料 download 候補の HEAD/GET 確認 | 維持 | Firefox MVP 対象外 |
| `chrome.runtime.sendMessage({ type: "cle-visible-files" })` (`554-...`) | 表示中 CLE 画面の資料抽出 | 維持 | Firefox MVP 対象外 |
| `chrome.runtime.sendMessage({ type: "cle-document-files" })` (`574-...`) | CLE document 詳細から資料抽出 | 維持 | Firefox MVP 対象外 |
| `chrome.runtime.sendMessage({ type: "cle-download" })` (`996-...`) | 資料個別 download | 維持 | Firefox MVP 対象外 |
| `chrome.runtime.sendMessage({ type: "cle-download-batch" })` (`1031-...`) | 資料一括 download | 維持 | Firefox MVP 対象外 |
| `refreshCle()` (`1302-1456`) | CLE 基本取得: コース、課題、課題状態、未読メッセージ、連絡事項 | 維持 | Firefox MVP 対象 |

### `src/vite-env.d.ts`

| 箇所 | 用途 | Chrome 維持要否 | Firefox 代替要否 |
| --- | --- | --- | --- |
| `declare const chrome` (`3-7`) | TypeScript 上の `chrome.runtime.sendMessage` 型宣言 | 維持または置換 | `browser` と追加 API 型、または platform helper 型へ拡張 |

## manifest / build / zip 現状

| ファイル | 現状の入力 / 出力 | Firefox 対応での示唆 |
| --- | --- | --- |
| `public/manifest.json` | 本番拡張 manifest。MV3、`background.service_worker: "background.js"`、`permissions` に `downloads.ui`、`content_scripts` に `auth-content.js`、KOAN/CLE/IdP/MFA host permissions を定義 | Firefox 用 manifest では background 定義、Gecko ID、permission 差分が必要。`downloads.ui` は除外候補 |
| root `manifest.json` | 開発用 loader manifest。`dev-loader.js` を service worker とし、`public/` icon を参照 | Firefox 開発 loader を対象にするかは後続判断。通常配布対象ではない |
| `scripts/sync-manifest.mjs` | `package.json` の `version` を root / public manifest に同期し、`description` を public manifest に同期 | Chrome/Firefox manifest 分離後は両 manifest へ同期対象を拡張する |
| `scripts/build-zip.mjs` | `dist/` を再帰的に読み込み、root に `koan-plus.zip` を作成 | Chrome / Firefox package 分離時は入力 dir と出力 artifact 名の引数化または別 script 化が必要 |
| `vite.config.ts` | `outDir: "dist"`, `emptyOutDir: true` | `build:chrome` / `build:firefox` で `dist-chrome/` / `dist-firefox/` を分ける仕組みが必要 |
| `package.json` scripts | `build = sync-manifest && tsc -b && vite build`, `zip = npm run build && node scripts/build-zip.mjs`, `version = sync-manifest && git add manifest.json public/manifest.json` | 既存 `build` / `zip` は Chrome 用 `dist/` を維持。`build:chrome`, `build:firefox`, 必要に応じて `zip:chrome`, `zip:firefox`, `build:all` を追加する |

## `world: "MAIN"` 使用箇所の分類

`public/background.js` 内の `chrome.scripting.executeScript({ world: "MAIN" })` 使用箇所を
Firefox 対応方針に基づき以下の 3 カテゴリに分類する。

**分類基準**
- **A (isolated 代替)**: DOM 操作のみで代替可能。`world` 指定を外して isolated world で動作させれば Firefox でも動く。
- **B (page bridge 必要)**: page world のグローバル関数・変数に依存。Firefox では page bridge（`window.postMessage` 経由）が必要。
- **C (実装待ち/未対応)**: MVP では対応必須外。未対応エラーまたは実装待ち表示で安全に扱う。

| 行 | func 内容 | 用途 | 分類 | 理由 / 代替方針 |
| --- | --- | --- | --- | --- |
| 479-542 | DOM から `[role="region"]` や `aria-controls` を探索し添付ファイルを抽出 | CLE 資料抽出 | A | DOM 操作のみ。`world` 指定を外せば Firefox でも動く |
| 672-698 | `fetch(url)` で CLE が API ready か確認 | CLE API probe | A | tab 内 fetch。`world` 指定を外し isolated で動作可能 |
| 868-905 | `globalThis.execSrvStatus("register")` / form.submit で MFA 登録画面を遷移 | MFA 登録 | B | `execSrvStatus` は page world のグローバル関数。Firefox MVP では必須外 |
| 1198-1223 | `globalThis.LoginSubmit("ログイン")` / form.submit で IdP ログイン送信 | IdP 自動ログイン | B | `LoginSubmit` は page world のグローバル関数。Firefox MVP では必須外 |
| 1383-1428 | `fetch(url)` で CLE 資料 URL の HEAD/GET を並列実行 | CLE 資料 HEAD batch | C | Firefox MVP では必須外（資料一括 DL の前処理） |
| 1531-1567 | `fetch(request)` で `koan-fetch` / `cle-fetch` のタブ内 fetch | KOAN/CLE 基本取得 | A | fetch のみ。`world` 指定を外せば Firefox でも動く。**Firefox MVP の最優先対応項目** |

**class A (isolated 代替) の対応方針**

`world: "MAIN"` を `world: "ISOLATED"` または world 指定なしに変更する。
Firefox では `world` パラメータが `scripting.executeScript` で ESR 140 以降利用可能か検証し、
利用不可の場合は world 指定を省略してデフォルトの ISOLATED で動作させる。

**class B (page bridge) の対応方針**

page world のグローバル関数に依存するため、Firefox では page bridge を実装する。
MVP ではこれらの機能（自動ログイン、MFA 自動登録）は必須外のため、
bridge 実装は後続タスクとする。

**class C (未対応) の対応方針**

MVP での対応は必須外。CLE 資料ダウンロード関連の処理であり、
未対応の場合は明示的なエラーを返す。

## 実装済み Firefox 互換対応

- **`isExtensionPageSender`**: `chrome-extension:` と `moz-extension:` の両方を許可（`public/background.js:85-91`）
- **`storage.session` fallback**: 軽量 in-memory Map fallback + `hasSessionApi()` 検出（`public/background.js:285-318`）
- **`downloads.setUiOptions`**: `typeof chrome.downloads.setUiOptions === "function"` で feature detection 済み（`public/background.js:1304`）
- **`browser_specific_settings.gecko.id`**: `public/manifest.firefox.json` に `koan-plus@cuore-mm` を設定済み

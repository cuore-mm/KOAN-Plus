## Context

KOAN Plus は Vite + React + TypeScript のローカル専用ブラウザ拡張で、UI は `src/App.tsx` を中心に構成され、本番拡張の manifest と background/content script は `public/` 配下に置かれている。現在の本番 manifest は `public/manifest.json` の Chrome MV3 用で、`background.service_worker: "background.js"`、`action`、`content_scripts`、`permissions`、`host_permissions` を定義している。root `manifest.json` は開発用ローダーであり、`dev-loader.js` を service worker として使う。

現状のブラウザ API 利用は Chrome 前提で、`public/background.js`、`public/auth-content.js`、`src/App.tsx`、`src/auth.ts` などで `chrome.*` を直接参照している。特に `public/background.js` では `chrome.scripting.executeScript({ world: "MAIN" })`、`chrome.storage.session`、`chrome.downloads.setUiOptions`、`chrome.tabs.*`、`chrome.runtime.*` が主要ワークフローに組み込まれている。Firefox では `browser.*` Promise API、`moz-extension:` URL、background 定義、`downloads.ui`、`storage.session`、`scripting.executeScript` の `world` 指定に差異があり、現状のままでは読み込みまたは主要機能で失敗する可能性が高い。

この変更では、Chrome 版の既存挙動を維持しながら Firefox 版を追加する。実装担当者はまず既存ファイルを確認し、Chrome 固有処理を一箇所に集約する。コード変更時は生成物 `dist/`、ZIP、`node_modules/`、`*.tsbuildinfo` をコミットしない。

## Goals / Non-Goals

**Goals:**

- Chrome と Firefox の両方で拡張機能をビルドできるブラウザ別ビルド構成を作る。
- Firefox で `about:debugging` から一時ロードできる manifest を生成する。
- `chrome.*` と `browser.*`、callback と Promise の差異を吸収する互換レイヤーを導入する。
- `chrome-extension:` と `moz-extension:` の両方を拡張ページとして扱えるようにする。
- `storage.session`、`downloads.setUiOptions`、`scripting.executeScript` の Firefox 差異に対して feature detection または代替経路を提供する。
- Firefox のサポート対象を「最新版」と「現行 ESR」に限定し、最低サポートバージョンは実装時点の現行 Firefox ESR major に合わせる。
- Chrome 版の `npm run build` と既存手動検証を回帰させない。
- Firefox MVP として、ダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE 基本取得を優先して動作させる。
- page world 依存が強い機能は、実装時に明示的な Firefox 代替経路を作るか、未対応状態をユーザーに分かる形で扱う。

**Non-Goals:**

- Firefox Add-ons / AMO への提出、署名、公開手続きはこの変更の範囲外。
- Safari、Edge 専用機能、Manifest V2 への対応は範囲外。
- 旧 ESR や古い Firefox のための複雑な互換処理は範囲外。
- KOAN、CLE、IdP、MFA の仕様自体の変更は行わない。
- UI デザインの大幅な刷新は行わない。
- 自動 E2E テスト基盤の本格導入は必須範囲外。ただし `web-ext lint` など軽量検証の追加は許容する。

## Decisions

### Decision 1: ブラウザ別 manifest と出力を分離する

`public/manifest.json` だけを条件分岐で書き換えるのではなく、Chrome 用と Firefox 用の manifest ソースを分ける。候補は `public/manifest.chrome.json` と `public/manifest.firefox.json`、または manifest template + build script による生成とする。実装担当者は既存 `scripts/sync-manifest.mjs` が `package.json` の `version` / `description` を同期していることを確認し、両ブラウザ用 manifest に同じメタデータを反映する。

コマンド契約は次を既定とする。既存互換のため `npm run build` は Chrome 用ビルドとして維持し、出力先も現行どおり `dist/` とする。新規に `npm run build:chrome` は Chrome 用成果物を `dist-chrome/`、`npm run build:firefox` は Firefox 用成果物を `dist-firefox/` に生成する。必要に応じて `npm run build:all` は両方を順に実行する。ZIP 化を分離する場合は `npm run zip:chrome` が `dist-chrome/` または明記した Chrome 用出力から ZIP を生成し、`npm run zip:firefox` が `dist-firefox/` から ZIP/XPI 互換 artifact を生成する。既存 `npm run zip` は `dist/` を使う Chrome 用として維持する。package artifact の実ファイル名と出力先はタスク完了メモまたは PR 説明に記録する。

理由: Firefox は `background.service_worker`、`browser_specific_settings.gecko`、一部 permissions で Chrome と異なるため、単一 manifest に分岐を埋め込むと検証しづらい。ブラウザ別出力により、`dist-chrome/` と `dist-firefox/` のような成果物を別々に確認できる。

代替案: 単一 manifest を build 時にインプレース編集する案もあるが、差分が見えにくく、Chrome 回帰の検出が難しいため採用しない。

### Decision 2: 互換レイヤーを導入し、直接 `chrome.*` 参照を減らす

`src/platform/` などにブラウザ API の薄いラッパーを作り、runtime、tabs、storage、scripting、downloads の呼び出しを Promise ベースに統一する。`src/App.tsx` と `src/auth.ts` は可能な範囲でこのラッパーを使う。`public/background.js` は TypeScript バンドル外の可能性があるため、実装時に既存ビルド構成を確認し、共通化可能なら background 用共通モジュールまたは `public/` 配下の self-contained helper として導入する。

既定方針として、初期実装では `public/background.js` と `public/auth-content.js` を `public/` 配下の JavaScript として維持し、Vite/TypeScript 管理下への移動は行わない。background 側で必要な互換処理は、まず `public/` 配下の self-contained helper または同一ファイル内 helper として実装する。`webextension-polyfill` は初期既定では追加せず、自前の薄い wrapper で不足が明確になった場合のみ依存追加を検討する。

理由: Chrome 用 callback と Firefox 用 Promise を各所で分岐すると保守性が落ちる。特に `src/App.tsx` の `chrome.tabs.create({...}, callback)` のような箇所は Promise 化することで両対応しやすい。

代替案: 全ファイルに `globalThis.browser ?? globalThis.chrome` を直接書く案は、差異のある API で漏れが出るため採用しない。

### Decision 3: Firefox サポート対象は最新版と現行 ESR に限定する

Firefox のサポート対象は Firefox 最新版と現行 Firefox ESR とする。最低サポートバージョンは実装時点の現行 ESR major に合わせ、実装開始時に Mozilla のリリース情報または `web-ext` / Firefox 実機で現行 ESR major を確認して記録する。

記録場所は、利用者向けには README または新規の互換性メモ（例: `docs/browser-support.md`）、実装進捗向けには `tasks.md` の該当タスク完了メモとする。最終的に公開ドキュメントへ最低サポートバージョンが残ることを必須とする。

ESR 対応のために軽い fallback は持つが、旧 ESR や古い Firefox のための複雑な互換処理は追加しない。例えば、存在確認だけで切り替えられる API fallback、TTL 付き一時状態、未対応 API の安全な no-op は許容する。一方で、旧 ESR 専用の大きな別実装、複数世代の API 分岐、古い Firefox のためだけの page bridge 方式追加は採用しない。

理由: 大学環境では ESR 利用があり得るが、旧 ESR まで広げると互換分岐が増えて Chrome 回帰リスクと保守コストが高くなるため。

代替案: 最新版のみを対象にする案は ESR 利用者を取りこぼすため採用しない。旧 ESR も対象にする案は保守負担が過大なため採用しない。

### Decision 4: Firefox では feature detection と軽い fallback を使う

以下の API は存在確認してから呼び出す。

- `chrome.storage.session`: 存在しない場合は `storage.local` または background 内メモリ + TTL 付きキーで短期状態を代替する。代替キーにはタブ ID や用途を含め、MFA などの一時情報が残り続けないよう削除処理を用意する。
- `chrome.downloads.setUiOptions`: 存在しない場合は UI 抑制を行わず、ダウンロード自体を継続する。
- `chrome.scripting.executeScript` の `world`: Firefox で未対応の場合は isolated world で動く処理へ置き換えるか、content script + page bridge を使う。

理由: Firefox 最新版と現行 ESR の API 差を許容しつつ、旧 ESR 向けの複雑な互換処理を避けるため。

代替案: すべての API 差を個別実装で吸収する案は、旧 ESR 互換と同等の複雑さになるため採用しない。

### Decision 5: `world: "MAIN"` 依存は機能単位で再設計する

`public/background.js` 内の `chrome.scripting.executeScript({ world: "MAIN", func: ... })` 利用箇所を棚卸しし、各用途を以下に分類する。

1. isolated world から DOM 操作だけで代替可能な処理。
2. page world のグローバル関数または変数が必要な処理。
3. fetch やフォーム送信など、background/content script 側に移して実現可能な処理。

分類 1 と 3 は Chrome/Firefox 共通処理に寄せる。分類 2 は Firefox 用に page bridge を導入する。page bridge を使う場合は、content script と page script の間を `window.postMessage` で接続し、送受信する message type、nonce、origin/source 検証を明確にする。

page bridge を実装する場合は、正常系だけでなく、未知の message type、nonce 欠落または不一致、`event.source !== window`、許可外 origin、不要な payload を拒否する検証を行う。許可 origin は manifest の `host_permissions` と同じ KOAN、CLE、OU IdP、MFA の明示的 allowlist を基準にし、`new URL(event.origin).origin` で正規化した完全一致を既定とする。scheme は HTTPS のみを許可し、invalid、opaque、`"null"`、parse 不能、非 HTTPS の origin は処理前に拒否する。wildcard または subdomain 許可が必要な場合は、manifest と allowlist の両方に理由付きで追加する。`moz-extension:` や `chrome-extension:` 由来の拡張内部 message と page origin message は別経路として扱い、page bridge の allowlist に混ぜない。資格情報、TOTP、セッション関連値は console、DOM、例外 message、bridge payload に不要に出力しない。

理由: `world: "MAIN"` を無条件に使い続けると Firefox の主要機能が壊れる。全てを page bridge に寄せるとセキュリティ面と実装複雑性が増すため、必要箇所だけに限定する。

代替案: Firefox では該当機能をすべて未対応にする案は MVP としては可能だが、最終的な Firefox 対応として不十分なため採用しない。

### Decision 6: MVP と完全対応を分けてタスク化する

最初の完了判定は「Firefox で拡張を読み込み、ダッシュボード、オンボーディング、保存済みデータ表示、KOAN/CLE 基本取得が動く」ことに置く。自動ログイン、MFA 自動登録、CLE 資料ダウンロードは page world 依存が残るため、MVP 後に個別検証する。

Firefox MVP における KOAN/CLE 基本取得とは、利用者が Firefox 上で対象サイトへ手動ログイン済み、または既存セッション Cookie が有効な状態で、Chrome 版の手動セッション更新フローがダッシュボード表示に使う KOAN/CLE データカテゴリを取得することを指す。正確なカテゴリ一覧は実装開始時に既存実装を確認して README または `docs/browser-support.md` に記録する（例: ダッシュボードに表示する授業、掲示、課題、予定などのうち現行 Chrome 手動更新で取得しているもの）。MVP に含めるカテゴリは、この記録済み一覧に基づいて検証する。MVP には、資格情報の自動入力、MFA 自動登録、MFA 自動突破、CLE 資料ファイルの一括ダウンロード、page world のグローバル関数に依存する追加取得は含めない。認証が必要な状態では、無限待機や自動ログインの暗黙実行ではなく、利用者に手動ログインまたは未対応理由が分かるエラーを返す。

この OpenSpec change の完了条件は、Firefox 最新版と現行 ESR で MVP 機能が動作し、Chrome 既存機能が回帰していないこととする。自動ログイン、MFA 自動登録、CLE 資料ダウンロードは、この change 内で完全対応できれば検証対象に含めるが、未対応の場合でも、Firefox では明示的な未対応エラーまたは実装待ち表示になり、クラッシュ、無限待機、資格情報漏洩を起こさなければ完了可能とする。完全な Firefox 対応は後続 change に分離してよい。

理由: 全機能を一度に移植すると失敗箇所の切り分けが難しく、Chrome 回帰リスクも高い。

代替案: 全機能を一括対応してから検証する案は、変更範囲が大きすぎるため採用しない。

## Risks / Trade-offs

- [Risk] Firefox 用 manifest が Chrome 用 manifest と乖離し、version、description、host permissions の同期漏れが起きる → `scripts/sync-manifest.mjs` で両 manifest を同時に更新し、`npm run build:chrome` / `npm run build:firefox` の両方で検証する。
- [Risk] 互換レイヤー導入により Chrome 既存挙動が壊れる → 置換は機能単位で行い、各段階で `npm run build` と Chrome 手動ロードを実施する。
- [Risk] `storage.session` fallback に一時認証状態が残る → TTL、用途別 key prefix、処理完了時の削除、タブ close 時の削除を実装する。認証情報そのものは既存の IndexedDB 暗号化保存方針から逸脱しない。
- [Risk] page bridge が不正な message を受ける → message type、nonce、`event.source === window`、許可 origin または拡張内部の検証を必須にする。資格情報を page bridge へ渡す場合は最小限にし、ログ出力しない。
- [Risk] Firefox では `downloads.setUiOptions` がないため一括ダウンロード時の UI が Chrome と異なる → Firefox では UI 抑制を仕様上保証しない。ダウンロード成功を優先する。
- [Risk] Firefox 現行 ESR と最新版で API サポートが異なる → feature detection と軽い fallback を前提にし、検証時に対象 ESR major と最新版 major を記録する。旧 ESR 専用の複雑な互換処理は追加しない。

## Migration Plan

1. 実装前に Firefox 最新版と現行 ESR major を確認し、最低サポートバージョンとして記録する。
2. 実装前に `chrome.*` 利用箇所、`world: "MAIN"` 利用箇所、manifest/build script を再調査して一覧化する。
3. Chrome 用ビルドを現状と同等に通す。既存 `npm run build` を壊さないことを最優先する。
4. ブラウザ別 manifest と build script を追加し、Chrome と Firefox の出力先を分離する。
5. `src/App.tsx`、`src/auth.ts` など UI/TypeScript 側から互換レイヤーへ置換する。
6. `public/background.js` と `public/auth-content.js` の Firefox 非互換 API を feature detection 付きにする。
7. Firefox 最新版と現行 ESR で MVP 機能を検証する。
8. page world 依存機能を分類し、必要なものだけ page bridge または代替実装へ移行する。

Rollback は、ブラウザ別 build script と manifest を追加した状態でも Chrome 用既存 manifest/build を維持することで行う。Firefox 用出力に問題がある場合は Firefox 用 npm script をリリース対象から外し、Chrome 用 `npm run build` と `npm run zip` のみを使う。

## Implementation Contract

- アプリケーションコードの実装時は、この change の spec と tasks を優先する。
- 直接 `chrome.*` を追加する場合は、なぜ互換レイヤー経由にできないかをコメントまたはタスク完了メモに残す。
- 新しい Firefox 用処理は Chrome の既存処理を削除せず、feature detection またはブラウザ別エントリで分離する。
- Firefox 向け互換処理は最新版と現行 ESR を対象にする。旧 ESR や古い Firefox のためだけの複雑な分岐は追加しない。
- Firefox 用 `browser_specific_settings.gecko.id` は、開発中の storage と拡張 URL を安定させるため固定 ID を manifest に設定する。候補は `koan-plus@cuore-mm` とし、AMO 提出時に変更が必要な場合のみ見直す。
- Build command は `npm run build` / `npm run build:chrome` / `npm run build:firefox` の契約を守る。既存 `npm run build` は Chrome 用として維持し、Firefox 専用の失敗で Chrome build を壊さない。
- `public/background.js` を大きく分割する場合は、Vite が `public/` をそのままコピーする挙動と、拡張 manifest から参照されるファイル名を必ず確認する。
- `src/vite-env.d.ts` または型定義には `chrome` と `browser` の両方、または採用する WebExtensions 型を反映する。
- `dist/`、ZIP、XPI、`node_modules/`、`*.tsbuildinfo` はコミットしない。
- 最低検証は Chrome 用 `npm run build`。Firefox 用 script を追加した場合は Firefox 用 build/lint も実行する。

## Testing Strategy

- `npm run build` で Chrome 既存ビルドが成功することを確認する。
- Chrome で `dist/` を `chrome://extensions` から読み込み、ダッシュボード起動、オンボーディング、既存データ表示、KOAN/CLE 取得を手動確認する。
- Firefox 用出力を Firefox 最新版と現行 ESR の `about:debugging#/runtime/this-firefox` から一時ロードし、ダッシュボード起動、オンボーディング、既存データ表示、KOAN/CLE 基本取得を確認する。
- KOAN/CLE 基本取得は、Firefox 上で利用者が手動ログイン済みの状態で成功すること、未ログインまたはセッション切れでは手動ログインが必要と分かるエラーになることを確認する。
- Firefox 用成果物では `npx web-ext lint --source-dir dist-firefox` を必須検証とし、lint error がある場合は完了不可とする。warning は内容を記録し、Firefox 最新版と現行 ESR の一時ロードに影響しないと判断できる場合のみ許容する。この change の必須成果物は一時ロード可能な `dist-firefox/` である。`web-ext build` または同等の packaging verification は、この change が Firefox package/XPI script を追加または変更する場合のみ必須とする。
- 自動ログイン、MFA 自動登録、CLE 資料ダウンロードは、Firefox 対応経路を実装した段階で個別に手動検証し、失敗時はユーザーに分かるエラー表示または未対応表示を行う。
- fallback 一時状態は、成功、失敗、TTL 期限切れ、対象タブ close の各ケースで削除されることを確認する。
- page bridge を実装した場合は、未知 message type、nonce 不一致、source/origin 不一致を拒否し、資格情報や MFA 関連値が console log やエラー文に出ないことを確認する。

## Future Work / Deferred Scope

- 自動ログイン、MFA 自動登録、CLE 資料ダウンロードの完全な Firefox 対応は、MVP 後の検証結果に基づいて後続 change に分離してよい。

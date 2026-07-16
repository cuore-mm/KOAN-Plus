## Context

KOAN Plus は Chrome MV3 拡張として実装され、background/content script から `chrome.*` を直接利用している。Firefox 最新版と現行 ESR 140 を調査・実機確認した結果、Firefox は `chrome.*` 互換 API、callback/Promise の既存利用形態、`storage.session`、Firefox 128 以降の `scripting.executeScript({ world: "MAIN" })` をサポートする。自動ログインも Firefox 実機で動作した。

実際に必要だった差異は、Firefox manifest の `background.scripts`、permission、Gecko ID、Firefox 用 package、および `moz-extension:` URL が内部 UUID を host に使う sender 検証である。本設計は、対象 Firefox で既に動くコードを抽象化し直さず、必要な差分だけを維持する方針へ改める。

## Goals / Non-Goals

**Goals:**

- 既存の Chrome build/package と runtime 挙動を維持する。
- Firefox 最新版と現行 ESR で読み込める成果物を `dist-firefox/` に生成する。
- Firefox 配布用 ZIP package を再現可能な command で生成する。
- Firefox 固有 manifest と sender identity の差異だけを局所的に処理する。
- 既存主要機能を Firefox で検証し、実際に差異が確認された場合だけ限定修正する。
- Firefox 対応に不要な互換レイヤー、fallback、重複 command を除去する。

**Non-Goals:**

- Firefox Add-ons / AMO への提出、署名、公開手続き。
- Firefox ESR 140 より古い Firefox のサポート。
- `chrome.*` 呼び出し全体の抽象化や `webextension-polyfill` 導入。
- サポート対象 Firefox が備える API のための fallback。
- page bridge の導入。
- KOAN、CLE、IdP、MFA の仕様変更や UI の大幅刷新。

## Decisions

### Decision 1: Firefox 専用 manifest を維持する

Chrome 用 `public/manifest.json` は変更せず、Firefox 用 `public/manifest.firefox.json` を別ソースとして維持する。Firefox manifest は `background.scripts`、`browser_specific_settings.gecko.id`、Firefox 対応 permissions と host permissions を持ち、`downloads.ui` を含めない。`package.json` をversionとdescriptionのsource of truthとし、`npm run build` と `npm run build:firefox` はpackage前に `scripts/sync-manifest.mjs` を実行する。version hookも両manifestを同期・stageする。

理由: Chrome と Firefox では background 定義が同一 manifest で表現できず、Firefox 配布では安定した Gecko ID が必要になるため。

### Decision 2: build/package command は必要最小限にする

command 契約は次の4つに限定する。

- `npm run build`: 既存 Chrome 成果物を `dist/` に生成する。
- `npm run zip`: 既存 Chrome package を生成する。
- `npm run build:firefox`: Firefox 成果物を `dist-firefox/` に生成する。
- `npm run zip:firefox`: `dist-firefox/` から Firefox 配布用 ZIP を生成する。

`build:chrome`、`build:all`、`zip:chrome`、`dist-chrome/`、専用 `prepare-chrome-build.mjs` は追加しない。`build` と `build:firefox` は対応する出力directoryをcleanにしてから完全なbuild出力を生成する。Firefox prepare scriptはFirefox manifestを最終的な `manifest.json` として配置し、不要なmanifest variantを成果物から除く最低限の責務だけを持つ。既存Chrome buildには `public/` からコピーされるFirefox manifest variantを `dist/` から除去する最小cleanupだけを加える。`zip` は必ず `build` を、`zip:firefox` は必ず `build:firefox` を先に実行し、独立してclean buildからpackageを作れる契約とする。ZIPは対応build directoryの完全な内容をZIP rootへ格納し、別ブラウザ用manifest variantだけを明示的除外対象とする。ソースmanifestとlint/package検証を信頼し、独自の重複validationは持たない。

理由: 既存 Chrome command がすでにあり、別名 command と出力先は Firefox 対応に必須ではないため。

### Decision 3: 既存 WebExtensions API 呼び出しを維持する

Firefox ESR 140 は既存コードが利用する `chrome.*` 互換 API、`storage.session`、`scripting.executeScript` の `world: "MAIN"` をサポートする。このため `src/platform/` 互換レイヤー、Promise 統一のためだけのリファクタ、`storage.session` のメモリ fallback、page bridge は維持しない。

既存 API 呼び出しがFirefox実機で失敗した場合は、失敗した API と呼び出し箇所を特定し、その箇所だけを修正する。旧 Firefox のための分岐は追加しない。

理由: 対象ブラウザですでに動く処理へ抽象化や fallback を追加すると、変更量と Chrome 回帰リスクだけが増えるため。

### Decision 4: sender identity の差異だけを runtime で吸収する

Firefox では `sender.id` / `runtime.id` が固定 Gecko ID、`moz-extension://` URL の host が内部 UUID になる。拡張ページ sender は次の条件で検証する。

- `sender.id === chrome.runtime.id`
- protocol が `chrome-extension:` または `moz-extension:`
- URL host が `new URL(chrome.runtime.getURL("")).host` と一致する

理由: `url.host === chrome.runtime.id` は Chrome では成立するが Firefox では成立せず、認証情報保存を含む拡張ページ限定操作が拒否されるため。

### Decision 5: `world: "MAIN"` はそのまま利用する

Firefox は version 128 以降 `scripting.executeScript` の MAIN world をサポートする。最低サポート Firefox ESR 140 では既存の自動ログイン、MFA、KOAN/CLE fetch、CLE資料処理を変更せず検証する。isolated world への置換やpage bridgeは計画しない。

### Decision 6: 配布 package を必須成果物にする

Firefox 用 ZIP は `npm run zip:firefox` でリポジトリルートの `koan-plus-firefox.zip` として生成し、生成元はclean build後の `dist-firefox/` とする。既存 `npm run zip` は `dist/` からリポジトリルートの `koan-plus.zip` を生成する契約を維持する。各commandは同名の既存ZIPを置換し、packageルートに `manifest.json` と必要な静的ファイルが存在し、別ブラウザ用manifest variantや生成途中ファイルが混入しないことを確認する。ここでの再現可能性はbyte-for-byte決定性ではなく、clean buildから同じ名前・入力契約で反復生成できることを意味する。`web-ext lint` とpackage commandの成功を完了条件とする。

## Risks / Trade-offs

- [Risk] Firefox manifest が Chrome manifest と乖離する → version/description 同期と build/package 検証を行う。
- [Risk] 独自 validation を外すと manifest 間違いを早期検出できない → `web-ext lint`、成果物確認、Firefox一時ロードを必須にする。
- [Risk] 互換レイヤーを戻す際に既存コードまで損なう → 削除対象を `src/platform/`、そのimportと利用に直接対応する `src/App.tsx` / `src/auth.ts` / `src/vite-env.d.ts` の変更、`public/background.js` のsession wrapperに限定し、Firefox manifest、sender修正、汎用エラー表現、無関係な変更を保持する。
- [Risk] 自動ログインやMFAの一部経路に未確認差異がある → 最新版とESRで機能別に手動確認し、必須ワークフローの失敗は本change内で失敗箇所だけを修正して再検証する。
- [Risk] Firefox packageは生成できてもAMOで署名できない → 本changeはZIP生成までとし、提出・署名は別changeにする。

## Migration Plan

1. 削除・保持inventoryに従い、Firefox対応の必須差分と任意差分を確定する。履歴やbranch全体を一括revertせず、無関係な変更を保持する。
2. `src/platform/`、そのimportと利用に直接対応する `src/App.tsx` / `src/auth.ts` / `src/vite-env.d.ts` の変更、および `storage.session` fallbackだけを戻す。
3. build/package scriptsを4 command契約へ簡素化する。
4. Firefox manifest、metadata同期、sender検証を保持する。
5. Chrome/Firefoxのbuild、package、lintを実行する。
6. Firefox最新版と現行ESR、およびChromeで主要ワークフローを手動確認する。
7. 対応バージョン、build/package手順、確認済み機能を文書化する。

Rollback は、整理前の互換レイヤーへ戻すのではなく、Firefox用commandをリリース対象から外して既存Chrome用 `npm run build` / `npm run zip` のみを利用する。

## Implementation Contract

- Firefox対応に必要であることを説明できないapplication code変更は残さない。
- `public/manifest.firefox.json`、Firefox prepare/package処理、sender検証は保持する。
- `npm run build` / `npm run zip` の既存契約を変更しない。
- Firefox固有commandは `build:firefox` / `zip:firefox` に限定する。
- 旧 ESR 向けfallbackやbrowser API全面抽象化を追加しない。
- 生成物、ZIP、XPI、`node_modules/`、`*.tsbuildinfo` はコミットしない。

## Testing Strategy

- `npm run build` と `npm run zip` でChrome成果物を検証する。
- `npm run build:firefox` と `npm run zip:firefox` でFirefox成果物と配布ZIPを検証する。
- `npx web-ext lint --source-dir dist-firefox` をerrorなしで完了させる。
- Firefox ZIPのルートにFirefox用 `manifest.json` と必要ファイルがあり、`service_worker`、`downloads.ui`、余分なmanifestがないことを確認する。
- Firefox最新版と現行ESRで、一時ロード、オンボーディング、保存済みデータ、KOAN/CLE取得、自動ログイン、TOTP入力、MFA登録、CLE資料ダウンロードを機能別に確認する。各確認についてFirefoxの完全なversion、OS、実施日、結果を記録する。
- MFA登録は所有者から明示的に許可されたtest accountだけで行う。実施前に現在のMFA状態と復旧手順を確認し、登録後は意図した状態へ復元できたことを確認する。資格情報、TOTP secret、cancel codeはcommit、PR、task完了記録、console logへ残さない。安全なtest accountまたは復旧手順を用意できない場合は検証を実行せず、本changeをblockedとして扱う。
- sender検証はproduction codeを変更せず、`/tmp/opencode` 配下の非commit Node harnessでbackground helperをmock環境に読み込み、Chrome正例、Firefox UUID正例、ID/URL欠落、URL parse失敗、未対応protocol、ID不一致、host不一致、および拒否後も次caseを実行できることを確認する。
- 実機確認結果はPR説明またはcommitされないverification memoへ、browser完全version、OS、実施日、各workflowのpass/failだけを記録する。秘密値や大学systemの非公開情報は記録しない。
- Chromeで同じ主要機能を確認し、整理による回帰がないことを確認する。

## Future Work / Deferred Scope

- AMO提出、署名、公開、更新配信。
- AMO審査や将来のFirefox更新で初めて判明した互換差異への限定修正。

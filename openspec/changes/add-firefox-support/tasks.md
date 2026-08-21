## 1. 対応範囲と必須差分の確定

- [x] 1.1 Firefox Release最新版が、既存コードで利用する `chrome.*` 互換API、`storage.session`、`scripting.executeScript({ world: "MAIN" })` をサポートすることを確認する。
- [x] 1.2 Firefox 実機で拡張機能を一時ロードし、`background.service_worker` ではなく `background.scripts` が必要であることを確認する。
- [x] 1.3 Firefox の `runtime.id` / `sender.id` は Gecko ID、`moz-extension:` URL host は内部 UUID になり得ることを確認し、sender検証に必要な差分を特定する。
- [x] 1.4 自動ログインが既存content scriptと `world: "MAIN"` のままFirefoxで動作することを確認し、page bridge前提を撤回する。
- [x] 1.5 Firefox配布用ZIP生成までを本changeの必須範囲とし、AMO提出・署名・公開は範囲外とする。

## 2. 任意実装の巻き戻し

- [x] 2.1 [requires source inspection] `src/platform/browser.ts`、`runtime.ts`、`tabs.ts`、`index.ts` を削除し、それらのimportと利用に直接対応する `src/App.tsx` / `src/auth.ts` の変更だけを既存API呼び出しへ戻す。branchやcommit全体をrevertせず、Firefoxでも正確なユーザー向け表現と無関係な変更を保持する。
- [x] 2.2 [requires source inspection] platform wrapperのためだけに追加した `src/vite-env.d.ts` の型定義を戻し、TypeScript buildに必要な既存型だけを残す。
- [x] 2.3 [requires source inspection] `public/background.js` の `sessionFallback`、`hasSessionApi`、`sessionGet`、`sessionSet`、`sessionRemove` と、それらへの置換だけを戻し、Firefox最新版で利用可能な既存 `chrome.storage.session` 処理を復元する。sender検証修正と無関係な処理は保持する。
- [x] 2.4 Firefox対応前から存在した `downloads.setUiOptions` feature detectionは保持し、今回追加した説明だけの変更は差分から除く。
- [x] 2.5 `detectBrowser()`、汎用 `promisify()`、その他Firefox対応に使われないhelperや型が残っていないことを確認する。

## 3. build/package構成の最小化

- [x] 3.1 `npm run build` / `npm run zip` を既存Chrome commandとして維持し、追加commandを `npm run build:firefox` / `npm run zip:firefox` に限定する。`zip` は `build` を、`zip:firefox` は `build:firefox` をcommand内で必ず先に実行する。
- [x] 3.2 `build:chrome`、`build:all`、`zip:chrome`、`dist-chrome/` 専用処理、`scripts/prepare-chrome-build.mjs` を削除する。
- [x] 3.3 Firefox prepare scriptはFirefox manifestを `dist-firefox/manifest.json` に配置し、余分なmanifest variantを除去する最低限の処理へ簡素化する。独自manifest validationは削除する。既存Chrome buildには `dist/manifest.firefox.json` を除去する最小cleanupを残す。
- [x] 3.4 `scripts/build-zip.mjs` は既存Chrome packageとFirefox packageの入力・出力指定に必要な最小差分だけを残す。
- [x] 3.5 `package.json` をversion/descriptionのsource of truthとし、`npm run build`、`npm run build:firefox`、version hookから `scripts/sync-manifest.mjs` を実行してChrome/Firefox両manifestを同期する。versionとdescriptionをそれぞれ変更した検証用状態で両manifestへ反映され、version hookが両manifestをstageすることを確認する。検証後はmetadataとindexを元に戻し、test version、commit、tagを残さない。
- [x] 3.6 `dist-firefox/` とFirefox package artifactがコミットされないignore設定を維持し、不要になった `dist-chrome/` 専用設定を除去する。

## 4. 必須Firefox差分の保持

- [x] 4.1 Firefox manifestで `background.scripts: ["background.js"]`、`browser_specific_settings.gecko.id: "koan-plus@cuore-mm"`、permissions `scripting` / `storage` / `tabs` / `downloads`、host permissions `https://koan.osaka-u.ac.jp/*` / `https://www.cle.osaka-u.ac.jp/*` / `https://ou-idp.auth.osaka-u.ac.jp/*` / `https://auth-mfa.auth.osaka-u.ac.jp/*` を使用し、`background.service_worker` と `downloads.ui` を含めない。
- [x] 4.2 `isExtensionPageSender` で `chrome-extension:` と `moz-extension:` を許可し、`new URL(chrome.runtime.getURL("")).host` を使ってFirefox内部UUIDを検証する。
- [ ] 4.3 任意実装の巻き戻し後も、オンボーディングの資格情報保存を含む拡張ページ限定messageがFirefoxで許可されることを確認する。sender ID欠落、URL欠落・parse不能、未対応protocol、ID不一致、host不一致は例外でbackground全体を停止させずfail closedで拒否されることを確認する。
- [x] 4.4 production fileを変更せず `/tmp/opencode` 配下に非commit Node harnessを作り、Chrome sender正例、Firefox Gecko ID/内部UUID正例、ID欠落、URL欠落・parse不能、未対応protocol、ID不一致、host不一致を実行する。期待どおり許可・拒否され、拒否後も後続caseが実行されることを確認する。

## 5. build・lint・package検証

- [x] 5.1 `npm run build` を実行し、既存Chrome成果物が `dist/` に生成されることを確認する。
- [x] 5.2 `npm run build:firefox` を実行し、Firefox成果物が `dist-firefox/` に生成されることを確認する。
- [x] 5.3 `npx web-ext lint --source-dir dist-firefox` を実行し、errorなしで完了することを確認する。warningがある場合は内容と許容理由を記録する。
- [x] 5.4 stale markerを各出力directoryへ一時配置した後に `npm run zip` と `npm run zip:firefox` を実行し、各commandが対応buildを先に実行してmarkerを除去し、リポジトリルートの `koan-plus.zip` と `koan-plus-firefox.zip` を生成することを確認する。同名artifactが存在する場合も安全に置換されることを確認する。
- [x] 5.5 Chrome ZIPがclean後の `dist/` 完全出力をZIP rootに持ちFirefox manifest variantを含まないこと、およびFirefox ZIPがclean後の `dist-firefox/` 完全出力をZIP rootに持ち、`service_worker`、`downloads.ui`、Chrome用manifest variant、stale marker、生成途中ファイルがないことを確認する。
- [x] 5.6 build/package生成物がgit差分に含まれていないことを `git status --short` で確認する。

## 6. Firefox実機確認

- [ ] 6.1 Firefox最新版で `dist-firefox/manifest.json` を一時ロードし、manifest errorがないことを確認する。Firefoxの完全なversion、OS、実施日、6.2〜6.6のpass/failをPR説明またはcommitされないverification memoへ記録する。
- [ ] 6.2 Firefox最新版でオンボーディングの「保存して利用開始」を実行し、資格情報保存後にダッシュボードへ進めることを確認する。
- [ ] 6.3 保存済みデータ表示とKOAN/CLEデータ更新を確認する。
- [ ] 6.4 未ログイン状態からID・パスワードの自動入力・送信が完了することを確認する。
- [ ] 6.5 所有者が明示的に許可したtest accountと確認済み復旧手順を用意し、現在のMFA状態を確認してからTOTPコードの自動入力とMFA自動登録をそれぞれ確認する。実施後は意図したMFA状態へ復元する。資格情報、TOTP secret、cancel codeをcommit、PR、verification memo、console logへ残さない。安全なaccountまたは復旧手順を用意できない場合は実行せず、本changeをblockedとして扱う。
- [ ] 6.6 CLE資料ダウンロードを確認し、Firefoxに `downloads.setUiOptions` がない場合もダウンロード自体が継続することを確認する。
- [ ] 6.7 実機でFirefox固有の失敗が見つかった場合は、失敗APIと経路を記録する。6.2〜6.6の必須ワークフローの失敗は本changeの完了を保留し、その箇所だけの修正タスクを追加して修正・再検証する。

## 7. Chrome回帰確認

- [ ] 7.1 Chromeで `dist/` を読み込み、ダッシュボード、オンボーディング、保存済みデータ、KOAN/CLE取得を確認する。
- [ ] 7.2 Chromeで自動ログイン、TOTP入力、MFA登録、CLE資料ダウンロードを確認する。
- [x] 7.3 最終差分をファイル単位で確認し、削除inventory以外の既存処理や無関係な変更を失っておらず、Chrome既存処理にFirefox対応と無関係な変更が残っていないことを確認する。

## 8. ドキュメントと最終確認

- [x] 8.1 `docs/browser-support.md` にChrome/Firefox build、Firefox package、一時ロード、Firefox最新版、確認済み機能を記録する。
- [x] 8.2 `docs/browser-support.md` の `world: "MAIN"` 分類とFirefox MVP制限の節に、Firefox 128以降対応済みで最新版向けpage bridgeが不要であることを反映する。
- [x] 8.3 `docs/browser-support.md` の自動ログイン、MFA、CLE資料ダウンロードを未対応・延期とする記述だけを、6章の実機確認結果に合わせて修正する。
- [ ] 8.4 最終差分が本changeの必須対象だけで構成され、OpenSpec要件を満たすことを確認する。

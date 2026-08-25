## 1. 現在の同意・送信経路確認

- [ ] 1.1 [requires source inspection] `src/Onboarding.tsx` と `src/App.tsx` で、資格情報保存、自動ログイン有効化、manual TOTP保存、MFA自動登録開始の直接ユーザー操作handlerを再確認し、`permissions.request()` を最初の非同期処理として呼べる箇所を記録する。
- [ ] 1.2 [requires source inspection] `public/background.js` の `auth-save`、`auth-ensure-koan`、`auth-ensure-cle`、`auth-refresh-cle`、`auth-auto-login-state`、`auth-credentials`、`auth-submit-idp`、`auth-totp`、`auth-mfa-pending-save`、`auth-mfa-confirm-save` を確認し、permission未許可時に秘密値を保存・返却・送信しない条件をhandlerごとに確定する。
- [ ] 1.3 [requires source inspection] `src/App.tsx` の `getContactUrl()` と `Sidebar` のお問い合わせanchorを確認し、クリック時の非同期permission確認後もChrome/Firefoxで確実に新規tabを開ける既存API経路を決定する。

## 2. Firefox manifestと最小型定義

- [ ] 2.1 `public/manifest.firefox.json` の `browser_specific_settings.gecko` に `strict_min_version: "140.0"` と `data_collection_permissions.optional: ["authenticationInfo", "technicalAndInteraction"]` を追加し、`required: ["none"]` を含めないことを生成manifestで確認する。
- [ ] 2.2 Chrome用 `public/manifest.json` に `data_collection_permissions` が追加されていないことをdiffと `npm run build` 後の `dist/manifest.json` で確認する。
- [ ] 2.3 `src/vite-env.d.ts` に `chrome.permissions.getAll()`、`chrome.permissions.request()`、`data_collection?: string[]` の使用に必要な型だけを追加し、汎用permission wrapperや未使用型を追加しない。

## 3. 認証permission helperとユーザー操作

- [ ] 3.1 `src/auth.ts` にFirefox判定、現在permission確認、`requestAuthenticationInfoPermission()` の小さなhelperを追加する。Chromeで `data_collection` keyがない場合は許可扱い、Firefoxで取得失敗またはkey欠落は拒否扱いになることを確認する。
- [ ] 3.2 `src/Onboarding.tsx` の「保存して利用開始」で、`saveAuthSettings()` より先に `authenticationInfo` を要求し、拒否時は保存せず既存status領域へ許可が必要なエラーを表示する。
- [ ] 3.3 `src/App.tsx` の資格情報保存と自動ログインoff→on操作で、既存保存処理より先にpermissionを要求する。自動ログインoff操作と資格情報削除ではrequestしないことを確認する。
- [ ] 3.4 `src/App.tsx` のmanual TOTP保存とMFA自動登録開始で、secret保存またはtab作成より先にpermissionを要求する。拒否時はMFA flowを開始しないことを確認する。
- [ ] 3.5 permissionを取り消した既存ユーザーが設定の保存・有効化操作で再許可でき、取消だけではIndexedDBの暗号化済みcredentialが削除されないことを確認する。

## 4. Backgroundの送信前防御

- [ ] 4.1 `public/background.js` にself-containedなFirefox data collection permission確認helperを追加する。Chromeは従来動作を許可し、Firefoxの未許可・取得失敗・key欠落は拒否することをmockまたは一時harnessで確認する。
- [ ] 4.2 `auth-save` でID/password/TOTPの保存または認証機能有効化を含むrequestだけをpermission必須にし、無効化と `auth-delete` / `auth-delete-mfa` は未許可でも完了することを確認する。
- [ ] 4.3 `auth-ensure-koan`、`auth-ensure-cle`、`auth-refresh-cle`、`auth-auto-login-state` で未許可時に自動認証を開始せず、長時間待機ではなく再許可が必要と分かる結果を返す。
- [ ] 4.4 `auth-credentials`、`auth-submit-idp`、`auth-totp` で送信直前にpermissionを確認し、取消後はID/password/TOTPコードを返却・送信しないことを確認する。
- [ ] 4.5 `auth-mfa-pending-save` と `auth-mfa-confirm-save` で未許可時にMFA secret/cancel codeを保存せず、permission再許可後は既存flowを実行できることを確認する。

## 5. お問い合わせの技術情報制御

- [ ] 5.1 `src/App.tsx` の `getContactUrl()` を最小変更し、versionは常に付加し、User-Agent parameterは引数またはpermission結果がtrueの場合だけ追加する。
- [ ] 5.2 `Sidebar` のお問い合わせクリック時に現在の `technicalAndInteraction` permissionを確認し、許可時はversion+User-Agent、未許可・確認失敗時はversionのみのGoogle Forms URLを新規tabで開く。
- [ ] 5.3 Chromeでは `data_collection` key不在により従来どおりversion+User-Agentを付加し、Firefoxのpermission管理用listenerや新規React global stateが追加されていないことをdiffで確認する。

## 6. 自動検証

- [ ] 6.1 `/tmp/opencode` などの非commit harnessまたは既存テスト手段で、Chrome互換、Firefoxの2permissionの許可/未許可、permission API失敗、認証取消後のfail-closed、User-Agent parameter有無を検証する。秘密値をfixtureやlogへ含めない。
- [ ] 6.2 `npm run build` と `npm run build:firefox` を実行し、TypeScriptと両browserのbuildが成功することを確認する。
- [ ] 6.3 `npm run zip:firefox` を実行し、Firefox packageのmanifestに最低versionとoptionalな2データ型があり、Chrome固有manifestが混入していないことを確認する。
- [ ] 6.4 `npx web-ext lint --source-dir dist-firefox` を実行し、error 0かつ `MISSING_DATA_COLLECTION_PERMISSIONS` warningが解消していることを確認する。残るwarningは内容と許容理由を記録する。
- [ ] 6.5 `git status --short` で `dist/`、`dist-firefox/`、ZIP、一時harnessがcommit対象に含まれないことを確認する。

## 7. 実機確認

- [ ] 7.1 Firefox最新版でinstall/about:addonsに `authenticationInfo` と `technicalAndInteraction` のoptional設定が表示されることを確認し、完全なversion、OS、実施日を記録する。
- [ ] 7.2 Firefoxで `authenticationInfo` の許可、拒否、取消、再許可を順に確認し、自動ログイン、TOTP入力、MFA自動登録、無効化、削除がspecどおり動くことを確認する。
- [ ] 7.3 Firefoxで `technicalAndInteraction` のon/offを切り替え、お問い合わせURLにversionが常にあり、User-Agent parameterが許可時だけ存在することを確認する。
- [ ] 7.4 Chromeでpermission promptが表示されず、資格情報保存、自動ログイン、TOTP/MFA、お問い合わせのversion+User-Agentが変更前と同等に動くことを確認する。

## 8. 最終差分確認

- [ ] 8.1 最終差分に新規permission管理module、polyfill、常駐permission listener、不要な型やstateがなく、変更が `public/manifest.firefox.json`、既存認証/UI/background経路、最小型定義に限定されていることを確認する。
- [ ] 8.2 OpenSpecの `firefox-data-consent` requirementsを最終実装と照合し、全scenarioの検証結果または未解決blockerを記録する。

# Firefox開発版のビルドと確認

Firefox対応は未公開です。対象はデスクトップ版Firefox 140以降で、Android対応は対象外です。
Chrome Web Storeへ審査提出した1.5.0のZIP・`v1.5.0`タグは変更しません。Firefox対応を含む次の公開時にバージョンを更新します。

## ビルド

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run zip:firefox
```

Chromeは `dist/`、Firefoxは `dist-firefox/` です。FirefoxのZIPは `koan-plus-firefox.zip` で、本体と第三者のライセンスを同梱します。
Firefox用manifestは `background.scripts` を使い、`downloads.ui` を要求しません。共通の権限・接続先・コンテンツスクリプトなどがChrome版とずれた場合、ビルドを失敗させます。

開発時はFirefoxの `about:debugging#/runtime/this-firefox` で「一時的なアドオンを読み込む」から `dist-firefox/manifest.json` を指定します。一時インストールはFirefox終了時に解除されます。一般配布には別途署名・公開手続きが必要です。

## 自動テスト

```sh
npx playwright install chromium firefox
npm run test:ui
npm run test:ui:firefox
npx web-ext lint --source-dir dist-firefox
```

- 単体テストは、合成した認証情報とブラウザAPIで権限拒否・取消・再許可、保存済み情報の保持、MFA自動登録の停止を確認します。
- 画面テストはChromium・Firefoxで同じ合成データを使います。拡張機能としてのインストール・権限ダイアログ・実認証の検証とは区別します。
- `web-ext lint` の警告は個別に確認します。共用background内の `downloads.setUiOptions` は存在確認で回避します。Androidの最低バージョン警告を理由にモバイル対応を追加しません。バンドルの `innerHTML` 警告だけでXSSの有無を判定せず、React / DOMPurifyと入力処理を確認します。

## 実Firefoxでの確認（実施結果は別途記録）

1. 手動ログインで利用を開始し、自動ログインの任意同意を拒否してもダッシュボードを使えることを確認する。
2. 設定または初回案内で自動ログインを保存し、Firefoxの認証情報の利用許可を拒否すると保存・認証が進まず、許可すると進むことを確認する。
3. `about:addons` の「権限とデータ」で認証情報の許可を取り消す。新しいID・パスワード・TOTPの自動入力と、進行中のMFA自動登録が停止することを確認する。既に大学側へ送信した情報を取り消す機能ではない。
4. 保存済みの暗号化した認証情報が保持され、自動ログインの停止・削除ができることを確認する。再許可すると自動ログインを利用できるが、取消済みのMFA登録は設定画面から明示的に開始するまで再開しないことを確認する。
5. `technicalAndInteraction` の許可なしではお問い合わせURLにUser-Agentの事前入力値がなく、許可ありでは付くことを確認する。Chromeの従来動作も確認する。
6. KOAN/CLEの通常取得、セッション切れからの復帰、授業資料の個別・一括保存をChrome・Firefox双方で確認する。

大学アカウントの画面・ログ・認証情報をGitHubへ添付しないでください。結果はブラウザ・OSのバージョン、実施した項目、成功・失敗だけを記録します。

参考：[Mozillaのデータ同意仕様](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)、[一時インストール](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)。

## 2026-09-06 のメンテナー確認結果

PR #1の元の4コミットを保持し、devの `0f81b73` を取り込んだ状態で確認しました。

- 型チェック、単体テスト161件、Chrome / Firefox両ビルド・Firefox ZIP生成：成功。
- Chromium / Firefoxの合成データによる画面テスト：各52件、計104件成功。Firefox 153.0（Playwrightビルド）を使用。
- Firefox 153.0の新しい一時プロファイルへ、`web-ext run` でビルド済み拡張機能を一時インストール：成功。
- `web-ext 10.6.0 lint`：エラー0、警告7。内訳はAndroidの最低バージョン1件、存在確認で回避するChrome専用API3件、React内部2件・DOMPurify内部1件の `innerHTML` 警告。アプリの外部HTML表示は既存のDOMPurifyによる処理を維持。
- Firefox ZIPの全12ファイル、本体・第三者ライセンス、manifestの切替を確認。`npm audit --omit=dev --audit-level=high` は検出0件。

この確認には大学の実アカウントでのログイン・MFA登録・資料ダウンロード、およびFirefox 140での動作は含みません。PR投稿者の実環境での確認報告と、今回のメンテナーの検証結果は区別します。

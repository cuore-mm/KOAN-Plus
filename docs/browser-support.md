# ブラウザ対応

KOAN Plus は Chrome MV3 に加えて、Firefox Releaseの最新版だけをサポート対象とする。最新版より古いFirefox専用の互換分岐は追加しない。

## サポート対象

| ブラウザ | 対象 | 備考 |
| --- | --- | --- |
| Chrome / Chromium | 現行版 | 既存 MV3 build と機能を維持する |
| Firefox Release | 最新版 | 実機確認では完全なversion、OS、実施日を記録する |

## Build と package

### Chrome

```bash
npm run build
npm run zip
```

- build出力: `dist/`
- package: リポジトリルートの `koan-plus.zip`
- `npm run zip` は先にChrome buildを実行し、cleanな `dist/` からZIPを生成する。

### Firefox

```bash
npm run build:firefox
npm run zip:firefox
```

- build出力: `dist-firefox/`
- package: リポジトリルートの `koan-plus-firefox.zip`
- `npm run zip:firefox` は先にFirefox buildを実行し、cleanな `dist-firefox/` からZIPを生成する。

生成されたdirectory、ZIP、XPI、`*.tsbuildinfo` はcommitしない。

## Firefoxへの一時ロード

1. `npm run build:firefox` を実行する。
2. Firefoxで `about:debugging#/runtime/this-firefox` を開く。
3. 「一時的なアドオンを読み込む」を選択する。
4. `dist-firefox/manifest.json` を選択する。

Firefox manifestはChrome manifestと次の点が異なる。

- `background.scripts: ["background.js"]` を使用する。
- `browser_specific_settings.gecko.id` は `koan-plus@cuore-mm`。
- permissionsは `scripting`、`storage`、`tabs`、`downloads`。
- Firefoxに存在しない `downloads.ui` permissionを含めない。
- KOAN、CLE、OU IdP、MFAの既存HTTPS host permissionsを維持する。

## Firefox API対応方針

Firefox最新版は、この拡張が利用する以下のAPI・実行形態をサポートする。

- Firefoxの `chrome.*` 互換API。
- `chrome.storage.session`。
- `chrome.scripting.executeScript()`。
- Firefox 128以降の `world: "MAIN"`。
- manifestから読み込む既存content script。

このため、Firefox対応だけを目的とするplatform wrapper、`storage.session` のメモリfallback、isolated worldへの置換、content scriptとpage script間のpage bridgeは使用しない。対象Firefoxで実際に失敗したAPIが見つかった場合だけ、その呼び出し箇所へ限定した修正を行う。

### `world: "MAIN"` を使う既存機能

以下はFirefox最新版で既存処理をそのまま検証する。

- CLE資料のDOM抽出とHEAD/GET確認。
- CLE API ready probe。
- KOAN/CLEのtab内fetch。
- IdPの `LoginSubmit()` を使う自動ログイン。
- MFA登録画面の `execSrvStatus()` 呼び出し。

これらをFirefox未対応とは扱わず、page bridgeも前提としない。

## 必須のruntime差分

Firefoxでは固定Gecko IDと `moz-extension:` URLのhostが同一とは限らない。

```text
runtime.id / sender.id = koan-plus@cuore-mm
URL host               = Firefox内部UUID
```

拡張ページsenderは次を確認する。

- `sender.id === chrome.runtime.id`
- protocolが `chrome-extension:` または `moz-extension:`
- URL hostが `new URL(chrome.runtime.getURL("")).host` と一致する

IDやURLの欠落、parse不能URL、未対応protocol、IDまたはhost不一致はfail closedで拒否する。

## 機能検証

以下はFirefoxで既存実装を利用する対象機能であり、未対応機能として除外しない。

- ダッシュボードと保存済みデータ表示。
- オンボーディングと資格情報保存。
- KOAN/CLEデータ取得。
- ID・パスワードの自動入力と送信。
- TOTPコードの生成・自動入力。
- MFA自動登録。
- CLE資料ダウンロード。

2026-07-16までの開発中確認では、Firefox成果物の一時ロードと自動ログインの動作が報告されている。最終完了には、整理後の成果物をFirefox最新版で再確認し、完全なbrowser version、OS、実施日、各機能のpass/failを秘密情報なしで記録する必要がある。

MFA登録は、所有者が許可したtest accountと確認済みの復旧手順がある場合だけ実施する。資格情報、TOTP secret、cancel codeはcommit、PR、console log、verification memoへ記録しない。

## `web-ext lint`

確認command:

```bash
npx web-ext lint --source-dir dist-firefox
```

2026-07-16の検証結果はerrors 0、warnings 7。warningの内訳と判断は次のとおり。

| warning | 件数 | 判断 |
| --- | ---: | --- |
| `MISSING_DATA_COLLECTION_PERMISSIONS` | 1 | AMO提出・署名は本changeの範囲外。ZIP生成と一時ロードを妨げないため現時点では許容し、AMO対応時に申告内容を決定する |
| `downloads.setUiOptions is not supported` | 3 | 呼び出しは既存のfeature detectionで保護され、FirefoxではUI抑制だけを省略してdownloadを継続するため許容する |
| `UNSAFE_VAR_ASSIGNMENT` | 3 | Vite生成bundle内の既存コードに対する警告。Firefox対応で新規導入された処理ではなく、lint errorではないため本changeでは許容する |

AMO提出時は `browser_specific_settings.gecko.data_collection_permissions` の申告要件を改めて確認する。

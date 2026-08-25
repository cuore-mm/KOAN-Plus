## Why

Firefox 140以降の組み込みデータ同意では、拡張機能がブラウザ外へ送信するデータ型をmanifestで宣言し、optionalな個人データは利用前にFirefoxの許可を得る必要がある。KOAN Plusは自動ログイン/MFAで認証情報を大学認証サービスへ送信し、お問い合わせフォームにはUser-Agentを付加するため、Firefoxの同意状態と実際の送信処理を一致させる。

## What Changes

- Firefox用manifestに `strict_min_version: "140.0"` とoptionalな `authenticationInfo` / `technicalAndInteraction` を宣言する。
- `required: ["none"]` はoptionalデータ型と併用しない。
- FirefoxでID・パスワードを保存して自動ログイン/MFAを有効化するユーザー操作時に、`permissions.request({ data_collection: ["authenticationInfo"] })` を実行する。
- `authenticationInfo` が未許可または後から取り消された場合、backgroundはID・パスワード、TOTPコード、MFA登録情報を認証ページへ渡さず、明示的なエラーを返す。暗号化済みローカル資格情報は自動削除しない。
- お問い合わせURLには拡張versionを常に付加する。User-Agentは `technicalAndInteraction` が許可されている場合だけ付加し、未許可時は該当query parameter自体を省略する。
- Chromeは `permissions.getAll()` に `data_collection` keyがないことをfeature detectionし、従来の自動ログイン/MFAとお問い合わせ動作を維持する。Firefoxは最低versionを140.0に限定し、permission状態を確認できない場合は対象データを送信しない。
- 変更量を抑えるため、新規permission管理moduleや常駐listenerは追加せず、既存の認証helper、クリック処理、background message handlerへ必要な確認だけを追加する。
- Firefoxの許可、拒否、取消、再許可とChrome回帰を検証する。

## Capabilities

### New Capabilities
- `firefox-data-consent`: Firefox組み込みデータ同意のmanifest宣言、認証情報のoptional許可、技術情報送信の制御、Chrome互換動作を扱う。

### Modified Capabilities
- なし。

## Impact

- 影響対象: `public/manifest.firefox.json`、`src/auth.ts`、`src/Onboarding.tsx`、`src/App.tsx`、`public/background.js`、`src/vite-env.d.ts`。
- Firefox API: `chrome.permissions.getAll()`、`chrome.permissions.request()`。
- 外部送信先: 大阪大学IdP/CLE/MFAサービス、ユーザー操作で開くGoogle Forms。
- Chrome用manifestにはFirefox固有の `data_collection_permissions` を追加しない。
- 新しい外部依存、developer backend、analytics、telemetryは追加しない。

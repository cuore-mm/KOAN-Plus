## Context

See `proposal.md` - Why. 現在のFirefox manifestはGecko IDを持つが、`data_collection_permissions` と `strict_min_version` を持たない。`web-ext lint` はデータ収集permission未宣言をwarningとして報告する。

認証情報は `src/Onboarding.tsx` と `src/App.tsx` のユーザー操作から `src/auth.ts` の `saveAuthSettings()` を経由し、`public/background.js` の `auth-save` handlerで暗号化保存される。ログインページでは `auth-auto-login-state`、`auth-credentials`、`auth-submit-idp`、`auth-totp` が自動ログイン/MFAを進める。MFA自動登録では `auth-mfa-pending-save` と `auth-mfa-confirm-save` がsecretを扱う。

お問い合わせURLは `src/App.tsx` の `getContactUrl()` が同期的にversionと `navigator.userAgent` をqueryへ追加し、`Sidebar` のanchorから開く。ChromeとFirefoxは同じReact application codeを使うため、Firefox固有manifestだけでなくruntime feature detectionが必要になる。

## Goals / Non-Goals

**Goals:**

- Firefox 140以降の組み込みデータ同意に合わせて認証情報とUser-Agentの送信を制御する。
- permission拒否・取消時に秘密値を外部ページへ渡さず、既存データを勝手に削除しない。
- Chromeの既存認証・お問い合わせ動作を維持する。
- 新規moduleや大規模state管理を作らず、既存経路への局所的な変更で完了する。

**Non-Goals:**

- 独自の同意画面、privacy dashboard、permission管理画面を新設する。
- `technicalAndInteraction` をruntimeで追加要求する。Firefoxのインストール時/アドオン設定の選択を使用する。
- 保存済みKOAN/CLEデータや大学ページ内容に新しい送信先を追加する。
- Google Forms、認証方式、暗号化vaultの構造を変更する。
- Firefox 139以前へ組み込み同意fallbackを提供する。

## Decisions

### Decision 1: Firefox manifestで2種類をoptional宣言する

`public/manifest.firefox.json` の `browser_specific_settings.gecko` に次を追加する。

```json
{
  "strict_min_version": "140.0",
  "data_collection_permissions": {
    "optional": [
      "authenticationInfo",
      "technicalAndInteraction"
    ]
  }
}
```

`required: ["none"]` はoptional型と排他的であるため追加しない。Chrome用 `public/manifest.json` は変更しない。

理由: 認証情報の利用は任意機能でありopt-inが必要である。User-Agentは技術情報であり、Firefoxのinstall/add-on settingsでoptional選択できる。Firefox 140未満をinstall不可にすることで、古いFirefox専用の独自同意fallbackを避ける。

### Decision 2: permission helperは既存 `src/auth.ts` に置く

新しいpermission管理moduleは作らない。`src/auth.ts` に小さなexported helperを追加し、次を行う。

- `chrome.runtime.getURL("")` のprotocolでFirefoxかを判定する。
- `chrome.permissions.getAll()` を呼び、`data_collection` key有無とpermission配列を確認する。
- Chromeのように `data_collection` keyがない環境は既存動作を許可する。
- Firefoxで取得失敗、key欠落、対象permission未許可の場合は対象データを送信不可とする。
- `requestAuthenticationInfoPermission()` は、既に許可済みなら即時成功し、未許可なら `permissions.request({ data_collection: ["authenticationInfo"] })` を実行する。

`src/vite-env.d.ts` は `chrome.permissions.getAll()` / `request()` と `data_collection?: string[]` に必要な最小型だけを追加する。汎用WebExtensions型やpolyfillは追加しない。

理由: `src/auth.ts` は認証設定の既存入口であり、変更ファイルと抽象化を増やさずに `src/Onboarding.tsx` / `src/App.tsx` から再利用できる。

### Decision 3: requestは既存の直接ユーザー操作だけで行う

Firefoxの `permissions.request()` はuser activation内で必要なため、backgroundやstartup refreshでは要求しない。次の既存操作で、ほかの非同期処理より先に `requestAuthenticationInfoPermission()` を呼ぶ。

- `src/Onboarding.tsx` の「保存して利用開始」。
- `src/App.tsx` Settingsの資格情報保存。
- 自動ログインをoffからonへ変更する操作。
- manual TOTP保存。
- MFA自動登録の「登録を開始」。

拒否時は後続の `saveAuthSettings()` やMFA tab作成を実行せず、既存status領域へ「自動ログイン/MFAには認証情報の利用許可が必要です」と表示する。自動ログイン/MFAの無効化、資格情報削除、MFA削除はpermissionなしでも実行できる。

理由: 共通保存関数で無条件要求すると、無効化操作までpromptする可能性がある。既存クリックhandlerの必要箇所だけに追加する方が変更は増えるが、挙動が明確で安全である。

### Decision 4: backgroundで送信直前に再確認する

UIのrequestだけに依存せず、`public/background.js` にself-containedなpermission確認helperを追加する。Firefoxかつ未許可ならfail closed、Chromeなら既存動作を許可する。

最小限の防御対象は次とする。

- `auth-save`: ID/password/TOTPの保存または自動ログイン/MFA有効化を含む場合。無効化・削除経路は許可する。
- `auth-ensure-koan` / `auth-ensure-cle` / `auth-refresh-cle`: 許可なしで自動認証tabを開始しない。
- `auth-auto-login-state`: 未許可時は自動送信無効として返す。
- `auth-credentials`: ID/passwordを返さない。
- `auth-submit-idp`: permission取消後にform submitしない。
- `auth-totp`: TOTPコードを生成・返却しない。
- `auth-mfa-pending-save` / `auth-mfa-confirm-save`: MFA登録secretを保存しない。

保存済み暗号化recordはpermission取消だけでは削除しない。ユーザーが再許可した後、既存設定を利用できる。既存ユーザーがupgrade後に未許可である場合、startupでpromptせず自動認証を停止し、設定画面の保存・有効化操作から再許可する。

理由: optional permissionは `about:addons` から後で取り消せるため、保存時確認だけでは不十分である。一方、全auth messageへ一律checkを追加すると削除や状態表示まで壊すため、秘密値の保存・返却・送信に限定する。

### Decision 5: User-Agentはお問い合わせクリック時に都度判定する

`getContactUrl()` は「version」と「User-Agentを含めるか」を引数または小さな分岐で受け取れる形へ変更する。versionは常にqueryへ追加する。

`Sidebar` のお問い合わせ操作では、クリック時に現在の `technicalAndInteraction` 状態を一度確認する。Firefoxで許可済みならUser-Agent queryを追加し、未許可・確認失敗ならparameter自体を追加しない。Chromeではfeature detection結果により従来どおりUser-Agentを追加する。

常駐state、`permissions.onAdded` / `onRemoved` listenerは追加しない。毎回click時に確認することで、`about:addons` での変更を次回クリックへ反映する。

外部tabは既存anchor相当のユーザー操作として開く。非同期確認後の `window.open()` がpopup blockされる実装は避け、既存 `tabs` APIまたはuser activationを保持できる最小の既存パターンをsource確認後に選ぶ。確認失敗時もversionのみのフォームを開く。

理由: お問い合わせ頻度は低く、clickごとのpermission確認は常駐listenerより単純である。

## Risks / Trade-offs

- [Risk] `permissions.request()` の前にuser activationを失う → 対象click handlerの最初の非同期処理として呼び、拒否/許可を実機確認する。
- [Risk] Firefox permissionを取り消してもcontent scriptが認証を続行する → backgroundの秘密値返却とform submitを再確認で停止する。
- [Risk] upgrade済みユーザーの自動ログインが突然停止する → 保存済みsecretは保持し、明示エラーから設定画面の保存/有効化で再許可できるようにする。
- [Risk] お問い合わせtabが非同期処理後にpopup blockされる → 実装前に既存Sidebarとtabs APIを確認し、クリックから確実にtabを開ける最小経路を採用してChrome/Firefoxで検証する。
- [Risk] permission APIの型追加が広がる → `src/vite-env.d.ts` は使用するmethodとfieldだけを宣言する。
- [Risk] Mozilla taxonomyの変更 → `web-ext lint` とFirefox最新版のinstall/about:addons表示をリリース前に確認する。

## Migration Plan

1. Firefox manifestへ最低versionとoptionalデータ型を追加する。
2. `src/auth.ts` と `src/vite-env.d.ts` に最小permission helper/typeを追加する。
3. Onboarding/Settingsの既存クリックhandlerへ認証permission要求を追加する。
4. backgroundの秘密値保存・返却・送信handlerへpermission checkを追加する。
5. お問い合わせクリック時のUser-Agent分岐を追加する。
6. build、lint、自動check、Firefox/Chrome実機確認を実行する。

Rollbackはmanifestの `data_collection_permissions` / `strict_min_version`、permission helper、各checkを同時に戻す。manifestだけoptional宣言してruntime request/checkを戻す状態は作らない。

## Implementation Contract

- 新しいpermission管理module、polyfill、React global state、常駐permission listenerを追加しない。
- Firefox固有manifest変更は `public/manifest.firefox.json` に限定する。
- `authenticationInfo` requestは直接ユーザー操作からのみ実行し、backgroundではrequestしない。
- backgroundはFirefoxのpermission確認失敗を許可扱いにせず、秘密値を返さない。
- Chromeで `data_collection` keyがない場合は既存挙動を維持する。
- permission取消だけでIndexedDBの暗号化credentialを削除しない。
- User-Agent未許可時は空文字parameterではなくparameter自体を省略する。
- version queryはpermissionに関係なく維持する。

## Testing Strategy

- `npm run build`、`npm run build:firefox`、`npm run zip:firefox` を実行する。
- `npx web-ext lint --source-dir dist-firefox` でデータ収集permission未宣言warningが解消し、error 0であることを確認する。
- 生成Firefox manifestにID、`strict_min_version: "140.0"`、optionalな2データ型があり、`required: ["none"]` がないことを確認する。
- Firefoxで `authenticationInfo` の許可、拒否、取消、再許可を確認する。
- Firefoxで未許可時にID/password/TOTP/MFA secretが認証ページへ渡らず、削除・無効化は実行できることを確認する。
- Firefoxで `technicalAndInteraction` のon/offそれぞれについて、お問い合わせURLにversionがあり、User-Agent parameterが許可時だけ存在することを確認する。
- Chromeでpermission promptが出ず、自動ログイン、MFA、version/User-Agent付きお問い合わせが従来どおり動くことを確認する。
- console、エラー、verification memoへID/password/TOTP secret/cancel codeを出力しない。

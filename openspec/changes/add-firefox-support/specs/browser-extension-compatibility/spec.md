## ADDED Requirements

### Requirement: Firefox 用成果物を生成する
システムは既存Chrome buildを維持しながら、Firefox Release最新版で読み込めるFirefox用成果物を生成できることをSHALLとする。

#### Scenario: 既存 Chrome build を維持する
- **WHEN** 開発者が `npm run build` を実行する
- **THEN** システムは既存互換の Chrome 用成果物を `dist/` に生成する

#### Scenario: Firefox build を実行する
- **WHEN** 開発者が `npm run build:firefox` を実行する
- **THEN** システムは Firefox 用成果物を `dist-firefox/` に生成する

#### Scenario: Firefox manifest を生成する
- **WHEN** Firefox 用成果物が生成される
- **THEN** 成果物の `manifest.json` は `background.scripts: ["background.js"]`、Gecko ID `koan-plus@cuore-mm`、permissions `scripting` / `storage` / `tabs` / `downloads`、host permissions `https://koan.osaka-u.ac.jp/*` / `https://www.cle.osaka-u.ac.jp/*` / `https://ou-idp.auth.osaka-u.ac.jp/*` / `https://auth-mfa.auth.osaka-u.ac.jp/*` を含み、`background.service_worker` と `downloads.ui` を含まない

#### Scenario: manifest metadata を同期する
- **WHEN** `package.json` の version または description が変更された後にChrome build、Firefox build、またはversion hookが実行される
- **THEN** `package.json` をsource of truthとしてChrome用manifestとFirefox用manifestの両方へ同じversionとdescriptionが反映される

### Requirement: Firefox 配布 package を生成する
システムは `dist-firefox/` からFirefox配布用ZIP packageを再現可能に生成できることを MUST とする。

#### Scenario: Firefox package command を実行する
- **WHEN** 開発者が `npm run zip:firefox` を実行する
- **THEN** command自身が `npm run build:firefox` 相当のclean buildを先に実行し、`dist-firefox/` の完全な内容をZIP rootへ格納したリポジトリルートの `koan-plus-firefox.zip` を生成し、同名の既存artifactを置換する

#### Scenario: 既存Chrome package commandを維持する
- **WHEN** 開発者が `npm run zip` を実行する
- **THEN** command自身が `npm run build` 相当のclean buildを先に実行し、`dist/` の完全な内容をZIP rootへ格納したリポジトリルートの `koan-plus.zip` を生成し、Firefox manifest variantを含めず、既存のChrome package契約を維持する

#### Scenario: Firefox package の内容を確認する
- **WHEN** 開発者が生成されたFirefox ZIPを検証する
- **THEN** ZIPルートにはFirefox用 `manifest.json` と必要な静的ファイルがあり、Chrome用manifest variantや生成途中ファイルが含まれない

#### Scenario: Firefox lint を実行する
- **WHEN** 開発者が `npx web-ext lint --source-dir dist-firefox` を実行する
- **THEN** コマンドはerrorなしで終了する

### Requirement: Firefox サポート対象を限定する
システムはFirefox Release最新版をサポート対象とすることをSHALLとする。最新版より古いFirefox専用の互換処理を追加しないことをMUSTとする。

#### Scenario: 対象Firefoxに既存APIが存在する
- **WHEN** Firefox Release最新版が既存コードの `chrome.*`、`storage.session`、または `scripting.executeScript({ world: "MAIN" })` をサポートする
- **THEN** システムはそのAPIのためだけの独自互換レイヤー、fallback、page bridgeを追加せず既存処理を利用する

#### Scenario: 古いFirefoxだけでAPIが不足する
- **WHEN** API不足がFirefox Release最新版より古いFirefoxでのみ発生する
- **THEN** システムは古いFirefox専用分岐を追加せずサポート対象外として扱う

### Requirement: Firefox 拡張ページsenderを検証する
システムはChromeとFirefoxの拡張ページidentity差異を考慮し、同一拡張機能からのmessageだけを許可することを MUST とする。

#### Scenario: Chrome 拡張ページからmessageを受信する
- **WHEN** sender IDがruntime IDと一致し、URLが同じ拡張の `chrome-extension:` URLである
- **THEN** システムは拡張ページsenderとして許可する

#### Scenario: Firefox 拡張ページからmessageを受信する
- **WHEN** sender IDがruntime IDと一致し、URLが `chrome.runtime.getURL("")` と同じhostを持つ `moz-extension:` URLである
- **THEN** システムはGecko IDとURL内部UUIDが異なっていても拡張ページsenderとして許可する

#### Scenario: 異なるsenderを拒否する
- **WHEN** sender IDまたはURLが欠落している、URLをparseできない、protocolが未対応である、sender IDがruntime IDと一致しない、または実際の拡張URL hostが一致しない
- **THEN** システムは例外によってbackground処理全体を停止させず、fail closedで拡張ページ限定操作を拒否する

#### Scenario: sender検証をfocused harnessで確認する
- **WHEN** 開発者がmockしたruntime ID、extension URL、senderを使う非commit test harnessを実行する
- **THEN** Chrome正例とFirefox内部UUID正例を許可し、ID/URL欠落、URL parse失敗、未対応protocol、ID不一致、host不一致をすべて拒否し、拒否後も後続caseを実行できる

### Requirement: Firefox で既存主要機能を利用する
システムはサポート対象Firefoxで既存のダッシュボード、認証、KOAN/CLE取得、MFA、資料ダウンロード処理を実行できることを SHALL とする。既存APIで動作する機能にFirefox専用代替経路を追加しないことを MUST とする。

#### Scenario: オンボーディングを完了する
- **WHEN** Firefox利用者が初回設定で資格情報を保存して利用開始する
- **THEN** システムはsenderを正しく検証して設定を保存し、ダッシュボードへ進む

#### Scenario: KOAN/CLEを取得する
- **WHEN** Firefox利用者がKOAN/CLEデータ更新を開始する
- **THEN** システムは既存の認証済みセッションまたは自動ログイン処理を利用してデータを取得する

#### Scenario: 自動ログインを実行する
- **WHEN** Firefox利用者が未ログイン状態で資格情報を保存済みである
- **THEN** 既存content scriptとMAIN world処理によって資格情報入力と送信を実行する

#### Scenario: MFA処理を実行する
- **WHEN** Firefox利用者がTOTP入力またはMFA登録を必要とする処理を開始する
- **THEN** システムは既存のTOTP生成、content script、MAIN world処理を利用する

#### Scenario: CLE資料をダウンロードする
- **WHEN** Firefox利用者がCLE資料ダウンロードを開始する
- **THEN** システムは利用可能なdownloads APIを使って処理し、`downloads.setUiOptions` がない場合は既存feature detectionによりUI抑制だけを省略する

#### Scenario: Firefox固有の失敗を発見する
- **WHEN** 実機確認で既存処理がFirefox固有の理由により失敗する
- **THEN** 開発者は失敗したAPIと経路を記録し、必須ワークフローの場合は本change内でその箇所に限定した修正と再検証を完了する

### Requirement: Firefox 対応差分を最小化する
システムはFirefox対応に直接必要な変更だけをapplication codeへ残すことを MUST とする。

#### Scenario: 任意の互換実装を整理する
- **WHEN** 対象Firefoxが既存APIをサポートしている
- **THEN** システムはそのAPIのためだけに追加されたplatform wrapper、fallback、page bridge、重複commandを保持しない

#### Scenario: Chrome 回帰を確認する
- **WHEN** Firefox対応差分の整理後にChrome版をbuild・実行する
- **THEN** Chrome版はFirefox対応前と同等に主要ワークフローを実行する

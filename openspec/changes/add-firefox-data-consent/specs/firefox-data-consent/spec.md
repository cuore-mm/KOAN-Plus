## Purpose

Firefoxの組み込みデータ同意とKOAN Plusの実際の外部送信を一致させ、認証情報とUser-Agentをユーザーが許可した範囲だけで扱いながらChromeの既存動作を維持する。

## ADDED Requirements

### Requirement: Firefox用manifestでデータ型を宣言する
システムはFirefox用manifestで最低Firefox versionを140.0とし、必須のデータ収集がないことを示す `required: ["none"]` と、`authenticationInfo` および `technicalAndInteraction` をoptionalなデータ収集permissionとして宣言することをMUSTとする。`none` はrequired配列内の他のデータ型と併用してはならない。

#### Scenario: Firefox成果物を生成する
- **WHEN** 開発者がFirefox用buildを実行する
- **THEN** 生成されたFirefox manifestはGecko ID、`strict_min_version: "140.0"`、optionalな `authenticationInfo` と `technicalAndInteraction` を含む

#### Scenario: Chrome成果物を生成する
- **WHEN** 開発者が既存Chrome用buildを実行する
- **THEN** 生成されたChrome manifestはFirefox固有の `data_collection_permissions` を含まない

### Requirement: 認証情報の利用前にFirefoxの許可を得る
システムはFirefox組み込みデータ同意に対応する環境で、自動ログインまたはMFAに必要な認証情報を新規保存・有効化する前に、ユーザー操作を起点として `authenticationInfo` のoptional permissionを要求することをMUSTとする。

#### Scenario: ユーザーが認証情報の利用を許可する
- **WHEN** ユーザーがID・パスワードの保存、自動ログインの有効化、TOTP secretの保存、またはMFA自動登録を開始し、Firefoxの許可画面で同意する
- **THEN** システムは該当処理を続行し、認証情報を暗号化して保存または認証処理に利用する

#### Scenario: ユーザーが認証情報の利用を拒否する
- **WHEN** ユーザーが `authenticationInfo` の要求を拒否する
- **THEN** システムは認証情報の新規保存・有効化・MFA自動登録を開始せず、許可が必要であることを示すエラーを表示する

#### Scenario: ユーザーが認証機能を無効化または削除する
- **WHEN** `authenticationInfo` が未許可の状態でユーザーが自動ログイン/MFAの無効化または保存済み認証情報の削除を実行する
- **THEN** システムはpermission要求を行わず、無効化または削除を完了する

### Requirement: 取消後の認証情報送信を停止する
システムは認証情報またはTOTPコードを認証ページへ渡す直前に現在の `authenticationInfo` permissionを確認することをMUSTとする。Firefoxでpermissionが存在しない場合、保存済み認証情報を保持したまま自動ログインとMFA送信を停止することをMUSTとする。

#### Scenario: Firefoxでpermissionが許可されている
- **WHEN** 認証ページがID・パスワードまたはTOTPコードを要求し、`authenticationInfo` が現在許可されている
- **THEN** システムは既存のsender検証後に必要最小限の認証情報を返す

#### Scenario: Firefoxでpermissionが取り消されている
- **WHEN** 認証ページが認証情報を要求し、ユーザーが `authenticationInfo` を取り消している
- **THEN** システムはID・パスワード、TOTPコード、MFA登録情報を認証ページへ渡さず、自動送信を行わず、再許可が必要と分かるエラーを返す

#### Scenario: permissionを再許可する
- **WHEN** permissionを取り消したユーザーが再び認証機能の保存または有効化操作を行い、`authenticationInfo` を許可する
- **THEN** システムは既存の暗号化済み認証情報を自動削除せず、設定内容に従って認証機能を再開できる

### Requirement: お問い合わせのUser-Agent送信を制御する
システムはお問い合わせURLへ拡張versionを常に付加し、User-AgentはFirefoxで `technicalAndInteraction` が許可されている場合だけ付加することをMUSTとする。未許可時はUser-Agent用query parameterを省略することをMUSTとする。

#### Scenario: 技術情報の送信が許可されている
- **WHEN** ユーザーがお問い合わせリンクを開き、`technicalAndInteraction` が許可されている
- **THEN** システムは拡張versionとUser-Agentを付加したGoogle Forms URLを開く

#### Scenario: 技術情報の送信が許可されていない
- **WHEN** ユーザーがお問い合わせリンクを開き、Firefoxで `technicalAndInteraction` が許可されていない
- **THEN** システムは拡張versionだけを付加し、User-Agent用query parameterを含まないGoogle Forms URLを開く

#### Scenario: 実行中に技術情報permissionが変更される
- **WHEN** ユーザーがFirefoxのアドオン設定で `technicalAndInteraction` を追加または取り消す
- **THEN** システムは次にお問い合わせリンクを開く際に最新のpermission状態を反映する

### Requirement: Chromeの既存動作を維持する
システムはChromeで `permissions.getAll()` の結果に `data_collection` keyが存在しないことをfeature detectionし、Chromeの認証機能とお問い合わせ動作を変更しないことをMUSTとする。Firefoxではkey欠落を許可扱いにしてはならない。

#### Scenario: Chromeで認証情報を保存・利用する
- **WHEN** Chromeでユーザーが認証情報を保存し、自動ログインまたはMFAを利用する
- **THEN** システムはFirefox固有permissionを要求せず、既存フローを実行する

#### Scenario: Chromeでお問い合わせを開く
- **WHEN** Chromeでユーザーがお問い合わせリンクを開く
- **THEN** システムは従来どおり拡張versionとUser-Agentを付加する

### Requirement: permission確認失敗時は安全側に停止する
システムはFirefox組み込みデータ同意に対応すると判定した後、permission状態の取得または要求に失敗した場合、対象データを外部送信してはならないことをMUSTとする。

#### Scenario: 認証permission確認が失敗する
- **WHEN** Firefoxで `authenticationInfo` のpermission状態を取得できない
- **THEN** システムは認証情報を返さず、再試行可能なエラーを返す

#### Scenario: 技術情報permission確認が失敗する
- **WHEN** Firefoxで `technicalAndInteraction` のpermission状態を取得できない
- **THEN** システムはUser-Agentをお問い合わせURLへ付加せず、拡張versionだけでフォームを開ける

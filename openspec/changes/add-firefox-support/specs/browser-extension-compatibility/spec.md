## ADDED Requirements

### Requirement: ブラウザ別ビルド
システムは Chrome 用と Firefox 用の拡張機能成果物を区別して生成できることを SHALL とする。各成果物は対象ブラウザに適した manifest、background 定義、permission、静的ファイルを含むことを MUST とする。

#### Scenario: Chrome 用成果物を生成する
- **WHEN** 開発者が Chrome 用ビルドを実行する
- **THEN** システムは Chrome MV3 として読み込める manifest と既存拡張ファイルを含む成果物を生成する

#### Scenario: Firefox 用成果物を生成する
- **WHEN** 開発者が Firefox 用ビルドを実行する
- **THEN** システムは Firefox WebExtensions として一時ロードできる manifest、background 設定、Gecko 固有設定を含む成果物を生成する

#### Scenario: 共通メタデータを同期する
- **WHEN** `package.json` の version または description が変更される
- **THEN** システムは Chrome 用 manifest と Firefox 用 manifest の両方へ同じ version と description を反映する

### Requirement: Firefox サポート対象バージョン
システムは Firefox 最新版と現行 Firefox ESR をサポート対象とすることを SHALL とする。Firefox の最低サポートバージョンは実装時点の現行 ESR major に合わせることを MUST とする。旧 ESR や古い Firefox のための複雑な互換処理は追加しないことを MUST とする。

#### Scenario: 最低サポートバージョンを記録する
- **WHEN** 開発者が Firefox 対応実装を開始する
- **THEN** システムまたは実装メモは現行 Firefox ESR major を最低サポートバージョンとして記録する

#### Scenario: Firefox 最新版と現行 ESR で検証する
- **WHEN** 開発者が Firefox 用成果物を検証する
- **THEN** 開発者は Firefox 最新版と現行 ESR の両方で MVP 機能を確認する

#### Scenario: 旧 ESR 専用分岐を避ける
- **WHEN** 対象 API が旧 ESR または古い Firefox でのみ不足している
- **THEN** システムは旧 ESR 専用の複雑な互換処理を追加せず、サポート対象外として扱う

### Requirement: ブラウザ API 互換呼び出し
システムは runtime、tabs、storage、scripting、downloads に関するブラウザ API 差異を互換レイヤーまたは同等の集約箇所で吸収することを SHALL とする。新規または変更されるアプリケーションコードは、原則として直接の `chrome.*` 追加を避けることを MUST とする。

#### Scenario: Promise ベースで tabs API を呼び出す
- **WHEN** システムが新しいタブを作成、更新、取得、削除する
- **THEN** Chrome と Firefox のどちらでも呼び出し元は Promise として結果またはエラーを扱える

#### Scenario: 拡張ページ送信者を検証する
- **WHEN** background が拡張ページからの message sender を検証する
- **THEN** システムは `chrome-extension:` と `moz-extension:` の両方を有効な拡張ページ URL として扱う

#### Scenario: 非対応 API を検出する
- **WHEN** 対象ブラウザに `storage.session` または `downloads.setUiOptions` が存在しない
- **THEN** システムは未定義 API を直接呼び出さず、現行 ESR 対応に必要な軽い fallback または安全な no-op に切り替える

### Requirement: Firefox での基本利用フロー
システムは Firefox で拡張機能を一時ロードした利用者に対し、少なくともダッシュボード起動、オンボーディング、保存済みデータ表示、KOAN/CLE の基本取得を提供することを SHALL とする。

#### Scenario: Firefox でダッシュボードを開く
- **WHEN** 利用者が Firefox に読み込んだ KOAN Plus のツールバーボタンまたは拡張ページを開く
- **THEN** システムはダッシュボード UI を表示する

#### Scenario: Firefox でオンボーディングを完了する
- **WHEN** 初回利用者が Firefox で利用規約同意と初期設定を行う
- **THEN** システムはオンボーディング完了状態を保存し、以後ダッシュボードへ進める

#### Scenario: Firefox で保存済みデータを表示する
- **WHEN** Firefox の拡張ページが保存済み KOAN/CLE データを読み込む
- **THEN** システムは Chrome 版と同等のダッシュボード表示を行う

#### Scenario: Firefox で KOAN/CLE 基本取得を実行する
- **WHEN** 利用者が Firefox で KOAN または CLE の基本データ取得を開始する
- **THEN** システムは対象ドメインの権限内でデータ取得を試行し、成功時はダッシュボードを更新する

### Requirement: Firefox 非互換機能の安全な取り扱い
システムは Firefox で未対応または代替実装が必要な機能を実行する場合、クラッシュや無限待機を起こさないことを MUST とする。未対応状態が残る場合は、利用者または開発者が原因を識別できるエラーを返すことを SHALL とする。

#### Scenario: MAIN world 注入が使えない
- **WHEN** Firefox で `scripting.executeScript` の page world 注入が必要な機能を実行する
- **THEN** システムは isolated world 代替、page bridge、または明示的な未対応エラーのいずれかに切り替える

#### Scenario: ダウンロード UI 抑制が使えない
- **WHEN** Firefox で一括ダウンロード処理を実行し、downloads UI 抑制 API が存在しない
- **THEN** システムは UI 抑制を行わずにダウンロード処理を継続するか、継続できない理由をエラーとして返す

#### Scenario: 一時状態 fallback を削除する
- **WHEN** Firefox fallback によって一時状態を保存した処理が完了、失敗、または対象タブが閉じられる
- **THEN** システムは該当する一時状態を削除し、資格情報や MFA 関連の一時データを不要に保持しない

### Requirement: Chrome 回帰防止
システムは Firefox 対応の追加後も Chrome 版の既存利用フローを維持することを SHALL とする。Firefox 用の分岐、manifest、fallback は Chrome 用ビルドと runtime に不要な破壊的変更を与えないことを MUST とする。

#### Scenario: Chrome 既存ビルドを検証する
- **WHEN** 開発者が既存の Chrome 用 build command を実行する
- **THEN** システムは TypeScript 検証、manifest 同期、Vite build を成功させる

#### Scenario: Chrome で既存主要機能を実行する
- **WHEN** 利用者が Chrome に KOAN Plus を読み込んで既存主要機能を使う
- **THEN** システムは Firefox 対応前と同等にダッシュボード、KOAN/CLE 取得、自動ログイン関連処理を実行する

#### Scenario: ブラウザ固有処理を分離する
- **WHEN** Firefox 固有の manifest または API fallback を追加する
- **THEN** システムは Chrome 固有処理を削除せず、対象ブラウザに応じた経路を選択する

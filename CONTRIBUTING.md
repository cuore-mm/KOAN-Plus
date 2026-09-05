# Contributing to KOAN Plus

KOAN Plus は大阪大学のKOAN/CLEに接続するローカル完結型の拡張機能です。
変更を送る前に、利用者の学務情報と認証情報をリポジトリへ持ち込まないことを
最優先にしてください。

## 開発環境

- Node.js `20.19.x` または `22.12.x` 以上の対応系列
- npm（`package-lock.json` と同じバージョン系列を推奨）
- UI E2Eを実行する場合はPlaywrightがサポートするChromium

依存関係は、再現性のため `npm install` ではなく次で導入します。

```sh
npm ci
```

## 変更前のチェック

最低限、次を実行してください。

```sh
npm run typecheck
npm test
npm run build
```

UI E2Eを含める場合は、初回だけChromiumを導入してから実行します。

```sh
npx playwright install chromium
npm run test:ui
```

CIと同じ順序をローカルで確認する場合は、次を順番に実行してください。

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

push前には、生成物・認証情報・個人情報が混入していないことも確認します。

```sh
git diff --check
git status --short
git diff --stat
```

## テストfixtureと個人情報

実在のKOAN/CLEデータをfixture、スクリーンショット、ログ、スナップショット、
サンプルHTMLとして追加してはいけません。次の情報をコミットしないでください。

- 学内ID、氏名、学生番号、メールアドレス、パスワード
- TOTPシークレット、一時解除コード、セッションCookie、認証ヘッダー
- 実在するKOAN/CLE URLのセッションパラメータや個人を識別できるID
- 成績、履修情報、掲示本文、CLEメッセージ本文、資料URL
- `localStorage` / IndexedDB / Chrome profile のエクスポート
- 実在アカウントで取得したPlaywright trace、video、screenshot、HTML

fixtureは、合成した日本語・ダミーID・無効化したURLだけで作成してください。
テストの失敗ログをIssueやPull Requestへ貼る前に、上記の情報と認証状態がないことを
確認してください。

## セキュリティ

認証情報、個人情報、XSS、権限、拡張機能の挙動に関する脆弱性は、公開Issueに
詳細を書かず、[SECURITY.md](./SECURITY.md) の報告手順を使ってください。
脆弱性を再現するコードが必要な場合も、実データではなく最小の合成fixtureを
使用します。

依存関係を更新する場合は、`package-lock.json` も同じ変更に含め、直接依存・推移依存・
Node対応範囲を確認してください。DOMPurifyのような入力処理ライブラリは、修正版を
優先し、セキュリティ修正を理由なく保留しないでください。
Dependabotの更新PRもlockfileを確認し、CIの完了後に手動レビューして取り込んでください。

## Pull Requestの方針

- 目的と変更範囲を本文の冒頭に書く
- UI、スクレイパー、保存データに影響する場合は、失敗時の挙動と後方互換性を説明する
- テストfixtureに個人情報がないことを明記する
- `npm run typecheck`、`npm test`、`npm run build` の結果を記載する
- UI変更では、必要に応じてChromium E2Eの結果と失敗時のスクリーンショットを確認する
- 生成物（`dist/`、`playwright-report/`、`test-results/`、zip、trace）をコミットしない

Pull RequestのCIは、同じブランチの新しい実行が開始されたときに古い実行をキャンセル
します。古い実行の結果だけを根拠にマージしないでください。

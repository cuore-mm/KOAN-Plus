# Security Policy / セキュリティポリシー

## English

### Supported Version

KOAN Plus does not currently publish a formal long-term support schedule.
Security fixes target the latest version available in this repository. Older
builds and local modifications may not receive fixes.

### Reporting A Vulnerability

Do not include vulnerability details, credentials, TOTP secrets, session data,
academic records, or screenshots containing personal information in a public
GitHub Issue.

Use the repository's **Security** tab and **Report a vulnerability** if GitHub
Private Vulnerability Reporting is available. If that option is not available,
use the contact form linked from the extension to request a private reporting
channel. In the initial message, include only:

- a short description of the affected feature;
- the KOAN Plus version or commit;
- whether the issue affects KOAN, CLE, login, MFA, or local storage;
- a way for the maintainer to reply.

Wait for a private channel before sending reproduction details or sensitive
material. Ordinary bugs that do not have a security impact may be reported in a
public Issue.

No fixed acknowledgement or resolution time is promised. Reports are assessed
according to severity, reproducibility, and maintainer availability.

### Scope

Examples of in-scope issues include:

- exposure of saved IDs, passwords, TOTP secrets, or cancellation codes;
- sending academic or authentication data to an undeclared destination;
- bypassing origin checks in background or content-script messaging;
- unauthorized script execution caused by the extension;
- vulnerabilities in bundled runtime dependencies.

Out of scope are vulnerabilities in Osaka University systems themselves,
social engineering, denial-of-service testing against university services, and
reports that require accessing another person's account without permission.

## 日本語

### サポート対象

KOAN Plus は、現時点で長期サポートや複数バージョンの保守方針を設けていません。
セキュリティ修正は、本リポジトリで提供されている最新バージョンを対象とします。
古いビルドや独自改変版には修正が提供されない場合があります。

### 脆弱性の報告

公開 GitHub Issue には、脆弱性の詳細、認証情報、TOTPシークレット、
セッション情報、学務情報、個人情報を含む画像を投稿しないでください。

リポジトリの **Security** タブに **Report a vulnerability** が表示される場合は、
GitHub Private Vulnerability Reporting を利用してください。表示されない場合は、
拡張機能内のお問い合わせフォームから、非公開の報告手段を依頼してください。
最初の連絡には、次の情報だけを含めてください。

- 影響を受ける機能の短い説明
- KOAN Plus のバージョンまたはコミット
- KOAN、CLE、ログイン、MFA、ローカル保存のどれに関係するか
- メンテナーが返信するための連絡手段

再現手順や機密情報は、非公開の連絡手段が確立してから送ってください。
セキュリティ上の影響がない通常の不具合は、公開 Issue で報告できます。

確認や修正までの時間は保証していません。重要度、再現性、メンテナーの対応可能性を
踏まえて評価します。

### 対象範囲

対象となる問題の例:

- 保存されたID、パスワード、TOTPシークレット、一時解除コードの漏えい
- 学務情報や認証情報の、明示されていない送信先への送信
- バックグラウンド処理やコンテンツスクリプトのオリジン検証の回避
- 拡張機能を起点とする不正なスクリプト実行
- 配布物に含まれる実行時依存関係の脆弱性

大阪大学側システム自体の脆弱性、ソーシャルエンジニアリング、大学サービスへの
DoS試験、許可なく他人のアカウントへアクセスする必要がある報告は対象外です。

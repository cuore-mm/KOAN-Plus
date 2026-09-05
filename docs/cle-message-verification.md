# CLEメッセージ取得の実データ確認

## 修正版を読み込む

1. `npm run build` を実行する。
2. 普段KOAN Plusを使っているブラウザの拡張機能管理画面（Chromeなら `chrome://extensions`）で、KOAN Plusの「再読み込み」を押す。読み込み元はこのプロジェクトの `dist/`。別の拡張機能として追加し直す必要はない。
3. KOAN Plusの画面も再読み込みする。同じブラウザ・プロファイルでCLEにログインしておく。
4. KOAN Plusの「同期の状態」でCLEの「再試行」を押す。大量の科目があり「続きから再開」と表示される場合は、画面を開いたまま自動同期を待つ。
5. CLE公式の「メッセージ」画面と、KOAN Plusの未読メッセージの科目・件数を照合する。公式画面の一覧に追加読み込みがある場合は最後まで読み込む。本文を開くと既読になるので、一覧だけで比較する。
6. CLEの同期が成功し、未読の科目・件数が一致することを確認する。一部未取得なら、警告文をそのまま報告する。キャッシュ削除で警告を消さない。

## ページ送りの診断（修正前にも実行可能）

サイドブラウザからAPI応答を直接確認できない場合に使用する。
普段のブラウザで、ログイン済みCLEの「メッセージ」ページを開き、開発者ツールのConsoleで以下を実行する。
最大4ページをGETで確認する。メッセージの送信・既読化・設定変更は行わない。
結果には件数、数値のページ位置、応答形式だけを含め、氏名・科目名・ID・本文・Cookieは出力しない。
Consoleが貼り付けを拒否する場合は、その保護を解除せず上記の画面比較だけを行う。

```js
(async () => {
  if (location.origin !== 'https://www.cle.osaka-u.ac.jp') {
    throw new Error('ログイン済みCLEのページで実行してください');
  }
  const path = '/learn/api/v1/messages/summary';
  const seen = new Set();
  const report = [];
  let offset = 0;
  for (let page = 0; page < 4; page++) {
    let response;
    try {
      response = await fetch(`${path}?offset=${offset}&limit=100`, {
        credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      report.push({ offset, error: 'network-or-timeout' });
      break;
    }
    if (!response.ok) {
      report.push({ offset, status: response.status });
      break;
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.results)) {
      report.push({ offset, error: 'invalid-results' });
      break;
    }
    const rows = body.results;
    let newCourses = 0;
    let invalidRows = 0;
    for (const row of rows) {
      if (typeof row?.courseId !== 'string' || !row.courseId) {
        invalidRows++;
      } else if (!seen.has(row.courseId)) {
        seen.add(row.courseId);
        newCourses++;
      }
    }
    const next = body.paging?.nextPage;
    let nextOffset = null;
    if (typeof next === 'string' && next) {
      try {
        const url = new URL(next, location.origin);
        const value = url.searchParams.get('offset');
        if (url.origin === location.origin && url.pathname === path &&
            /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value))) {
          nextOffset = Number(value);
        }
      } catch {}
    }
    report.push({
      offset, rows: rows.length, newCourses, invalidRows,
      pagingType: body.paging === null ? 'null' : typeof body.paging,
      nextType: next === null ? 'null' : typeof next,
      explicitEnd: next === null || next === '', nextOffset,
    });
    if (!rows.length || !newCourses || next === null || next === '') break;
    offset = nextOffset !== null && nextOffset > offset
      ? nextOffset : offset + rows.length;
  }
  console.log(JSON.stringify(report, null, 2));
})();
```

報告時は、このスクリプトの配列結果とKOAN Plusの警告文だけを共有する。
Networkの応答全文、認証ヘッダー、ストレージの内容を共有する必要はない。

# KOAN Plus

KOAN Plus is a local-only Chrome extension that presents KOAN information in a
readable dashboard. Ordinary KOAN pages are left unchanged.

## Data strategy

The dashboard fetches low-cost KOAN and CLE summaries when it opens and when
the user presses **更新**. Bulletin snapshots remain separately controlled.

- A lightweight refresh requests the KOAN portal, this week's class changes,
  and the unread bulletin list. A 10-minute cooldown is enforced in the request
  layer across dashboard tabs to avoid duplicate requests from repeated opens.
- A CLE refresh runs through an open, logged-in CLE tab. It requests the CLE
  calendar and message-summary endpoints, then checks submission state only for
  nearby assignment deadlines. CLE requests are GET-only.
- CLE message bodies and assignment bodies are never fetched or stored. The
  local cache contains assignment metadata, submission-state labels, and
  per-course unread message counts.
- A bulletin snapshot is run only when the user presses **掲示を同期**. It starts
  independent bulletin-board flows for each genre, follows pagination, waits
  at least 750 ms between page requests, and stores list metadata locally.
  Snapshots are limited to once every 6 hours, 12 pages per genre, and 3
  minutes per run. Incomplete runs are not cached.
- Bulletin bodies are never prefetched because opening a detail page may change
  unread state.
- Selecting a bulletin clears its unread badge in the local cache immediately.
  The next lightweight refresh reconciles the badge with KOAN's unread list.
- Cached bulletin detail URLs are never opened directly. When a user selects a
  bulletin, KOAN Plus starts a fresh bulletin-board flow and resolves a current
  `_flowExecutionKey` before opening the original KOAN detail page. Resolution
  is limited to one request chain at a time, 12 pages, and 1 minute.
- Authentication cookies remain managed by the browser. They are not read or
  stored by KOAN Plus.
- Cache data stays in the extension origin's `localStorage`.
- Fetch helpers reject destinations outside `https://koan.osaka-u.ac.jp`.
  CLE requests are separately restricted to `https://www.cle.osaka-u.ac.jp/learn/api/`.
- Every KOAN HTTP request is aborted after 15 seconds. The extension contains
  no timers or background jobs that periodically scrape KOAN or CLE.
- Failed operations also have retry delays: 1 minute for lightweight and grade
  refreshes, 10 minutes for bulletin snapshots, and 10 seconds for opening a
  bulletin detail.
- Grade data is fetched only when the user opens the grade tab and presses
  **成績を取得**. The request runs through an open KOAN tab so the old Web Flow
  session remains valid. It combines course-grade history with credit status,
  groups credits by KOAN's minor subject categories, and is stored only in the
  extension origin's `localStorage`.

KOAN does not expose a single low-cost page containing every current bulletin
title. Its initial bulletin page exposes unread titles and genre counts. The
snapshot operation is therefore intentionally visible and user-triggered.

## Development

```sh
npm install
npm run build
```

The source code is written in TypeScript and React.

Load the generated `dist/` directory from `chrome://extensions` using
**Load unpacked**.

Do not load the project root for normal use. The root manifest exists only to
show a development guide if the wrong directory is selected.

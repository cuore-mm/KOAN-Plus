# KOAN Plus

KOAN Plus is a local-only Chrome extension that turns Osaka University's KOAN
and CLE information into a readable academic dashboard.

The extension is designed to leave ordinary KOAN and CLE pages unchanged. It
fetches data only when the dashboard is opened, when the user refreshes it, or
when the user explicitly starts a heavier operation such as bulletin sync or
grade retrieval.

## Features

- Dashboard view for KOAN schedule, class changes, bulletins, CLE assignments,
  CLE unread message counts, and grades.
- Controlled KOAN refresh with request cooldowns to avoid duplicate work across
  dashboard tabs.
- CLE refresh through a logged-in CLE tab using GET-only API requests.
- User-triggered bulletin snapshot sync with pagination, delay, and runtime
  limits.
- User-triggered grade retrieval from KOAN.
- Optional local auto-login support for Osaka University authentication.
- Optional MFA/TOTP automation after explicit risk consent.

## Privacy And Data Handling

KOAN Plus is built as a local browser extension. It does not run a backend
service, and it does not upload QR images, credentials, bulletin bodies, CLE
message bodies, or assignment bodies.

Authentication cookies remain managed by Chrome. KOAN Plus does not read or
store those cookies. Cached dashboard data stays in the extension origin's
`localStorage`.

If optional auto-login is enabled, the university ID, password, and optional
TOTP secret are encrypted locally with AES-GCM using a non-extractable Web
Crypto key stored with the ciphertext in the extension's IndexedDB. Keeping a
password and TOTP secret on the same device improves convenience but weakens
the separation between authentication factors. Use this feature only if you
accept that tradeoff.

## Request Strategy

KOAN Plus intentionally separates lightweight refreshes from heavier user
actions.

- A lightweight dashboard refresh requests the KOAN portal, this week's class
  changes, unread bulletin metadata, CLE calendar items, and CLE message
  summary data.
- CLE assignment status enrichment is limited to nearby assignment deadlines.
- Bulletin snapshot sync runs only when the user presses **掲示を同期**. It
  follows pagination with delays and stores list metadata only.
- Bulletin bodies are not prefetched because opening a detail page may change
  unread state.
- Grade data is fetched only when the user opens the grade tab and presses
  **成績を取得**.

KOAN does not expose a single low-cost page containing every current bulletin
title. The bulletin snapshot operation is therefore intentionally visible and
user-triggered.

## Install For Local Use

This repository does not commit built extension files. Build the extension
locally before loading it in Chrome.

```sh
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the generated `dist/` directory.

Do not load the project root for normal use. The root manifest exists only to
show a development guide if the wrong directory is selected.

## Development

```sh
npm install
npm run dev
```

Production build:

```sh
npm run build
```

Preview build output:

```sh
npm run preview
```

Generated files such as `dist/`, `node_modules/`, and `*.tsbuildinfo` should
not be committed.

## Repository Status

This project is not an official Osaka University project. KOAN Plus is an
independent local browser extension for personal academic workflow support.

The extension depends on the current behavior of KOAN, CLE, and Osaka
University authentication pages. Those services may change without notice, so
users should review the code and build locally before use.

## License

MIT. See [LICENSE](./LICENSE).

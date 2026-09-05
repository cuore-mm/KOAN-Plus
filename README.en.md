# KOAN Plus

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[Japanese Version Available Here (日本語版はこちら)](./README.md)

KOAN Plus is a local-only Chrome extension that turns Osaka University's KOAN
and CLE information into a readable academic dashboard.

The extension is designed to leave ordinary KOAN and CLE pages unchanged. It
shows saved data immediately and, when auto-login is enabled, refreshes expired
data while the dashboard is visible and online. Manual refresh is also available.

## Security & Policy Risks

> [!WARNING]
> **Use at Your Own Risk**
> KOAN Plus is an unofficial tool. Using automation features (such as auto-login and MFA/TOTP automation) might violate Osaka University's Information Security Policies or Terms of Service. 
> 
> Automating MFA weakens the security of your account because it stores the TOTP secret key on the same device used to log in. Osaka University authentication systems or administrator policies might restrict, block, or take action against accounts that utilize automated login scripts. Except in cases of the developer's intent or gross negligence, the developer is not liable for account suspension, data loss, or other damages caused by the use of this extension.

---

## Features

- Dashboard view for KOAN schedules, class changes up to eight weeks ahead,
  near-term survey deadlines, bulletins, CLE assignments, unread message
  counts, and grades.
- Controlled KOAN refresh with request cooldowns to avoid duplicate work across
  dashboard tabs.
- CLE refresh through a logged-in CLE tab using GET-only API requests.
- Automatic and manual bulletin snapshot sync with pagination, delay, and runtime
  limits.
- Automatic and manual grade synchronization from KOAN.
- Optional local auto-login support for Osaka University authentication.
- Optional MFA/TOTP automation after explicit risk consent.

## Data And Permissions

KOAN Plus has no developer-operated backend, analytics, advertising, or crash
reporting. To retrieve academic data and perform authentication, it communicates
with the Osaka University KOAN, CLE, identity provider, and MFA domains declared
in the extension manifest.

Dashboard caches, grades, CLE assignments, bulletin metadata, and preferences
are stored in the extension origin's `localStorage`. Credentials are stored in
IndexedDB, and short-lived refresh coordination state is stored in
`chrome.storage.session`. Authentication cookies remain managed by Chrome; the
extension does not request the cookies permission.

If optional auto-login is enabled, the university ID, password, and optional
TOTP secret and temporary cancellation code are encrypted locally with
AES-GCM-256. The non-extractable key is stored in the same extension IndexedDB
as the ciphertext. This protects against casual plaintext inspection, but not
against compromise of the device, Chrome profile, or extension runtime.

The **Contact** link opens Google Forms. Opening it sends the extension version
and browser User-Agent to Google as prefilled query parameters. Information
entered and submitted through the form is also processed by Google.

The extension requests the `scripting`, `storage`, `tabs`, `downloads` (saving
CLE course materials), and `downloads.ui` (temporarily hiding the download
bubble during batch saves) permissions plus host access to the four Osaka
University domains listed in the manifest. See
[PRIVACY.md](./PRIVACY.md) for data categories, retention, and deletion, and
[SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Request Strategy

KOAN Plus uses separate cache lifetimes for frequently changing information and
expensive synchronization tasks.

- With auto-login enabled, startup, navigation, focus, reconnection, and a local
  30-second freshness check refresh only expired data. The local check itself
  sends no university requests. Hidden and offline pages start no automatic sync.
- Manual refresh reuses the last minute of recent bulletin, current class-change,
  CLE assignment-list, and message data while preserving longer-lived caches.
  Deferred requests retry automatically while visible and online. Web Locks
  serialize synchronization across tabs; completed cache writes are shared.
- Dashboard refresh fetches only the categories whose cache lifetime has expired.
- KOAN refreshes reuse category caches: this week's class changes and unread
  bulletins use a short interval, survey listings and the current schedule use
  a medium interval, schedule and class-change pages up to eight weeks ahead
  use a six-hour cache, and course registration mappings are refreshed daily.
- CLE refreshes reuse cached data by category. Message summaries normally use a
  15-minute cache, assignment lists 10 minutes, and course mappings 24 hours.
  Assignment status enrichment uses status-aware intervals because it costs
  additional per-assignment requests.
- CLE assignment status enrichment prioritizes nearby unfinished assignments.
  Normal refreshes inspect assignments due within the last 30 days, while
  submitted work remains eligible so posted grades can be detected. Graded,
  submitted, and expired items are rechecked after seven days, six hours, and
  24 hours respectively. The cache is not marked complete while eligible
  assignment statuses remain unchecked.
- CLE announcements are fetched progressively for currently enrolled courses.
  The selected and recently used courses are prioritized, with at most four
  courses fetched per refresh and a separate two-hour cache per course.
  Remaining courses continue on later refreshes.
- Bulletin snapshots use a six-hour cache for automatic and manual updates. The
  first run builds the snapshot; later runs stop paging per genre after two
  consecutive pages contain only previously known bulletins. Hitting a page
  limit leaves the snapshot marked partial. Resuming skips recently completed
  genres in the current cache format.
- Bulletin bodies are not prefetched because opening a detail page may change
  unread state.
- Expired cached data remains visible while refreshes run. Identical in-flight
  URL requests are shared, and repeated failures use per-target exponential
  backoff. Unexpected response shapes and incomplete pagination preserve the
  previous cache and are reported as partial refreshes instead of empty data.
- Grades refresh automatically on a six-hour cache lifetime, even without opening
  the grades page. Manual updates reuse the last minute of results. Authentication
  and fetch failures preserve saved data and use increasing retry delays.

Bulletin crawls retain page, runtime, and request-gap limits. Disabling auto-login
also stops periodic automatic synchronization; manual refresh remains available.

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

## Development & Requirements

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor setup, test
commands, security rules, and the ban on real personal-data fixtures.

### System Requirements

- **Supported Browsers**: Google Chrome 102 or later (and equivalent Chromium-based browsers supporting Manifest V3 and `chrome.storage.session`)
- **Node.js**: 20.19 or later, or 22.12 or later (for local builds)

### Development Setup

```sh
npm install
npm run dev
```

Install Chromium for UI tests once, then run the unit and UI test suites:

```sh
npx playwright install chromium
npm run test:all
```

To run them separately, use `npm test` for unit tests and `npm run test:ui`
for UI tests.

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

## Contributing

Contributions are welcome. Use GitHub Issues for ordinary bugs and feature
requests, and Pull Requests for code or documentation changes. Do not disclose
security-sensitive details in a public issue; follow [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).

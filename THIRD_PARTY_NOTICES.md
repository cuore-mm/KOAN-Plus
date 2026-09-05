# Third-party notices

KOAN Plus source code is covered by the root [MIT license](./LICENSE). Third-party
code and artwork retain their own copyright and license terms.

## Runtime dependencies

`package-lock.json` records the exact dependency versions. `npm run build`
copies the project license into `dist/LICENSE` and collects the full license and
notice files from installed production dependencies into
`dist/THIRD_PARTY_NOTICES.txt`. Both files are included in `koan-plus.zip`.

The generated inventory includes transitive production dependencies, even if
tree shaking or browser-specific entry points leave some out of the final
JavaScript. Development-only tools are not included in the extension notices.
Missing license files or installed versions that differ from the lockfile stop
the build so they can be reviewed before distribution. Use `npm ci` first.

DOMPurify offers a choice of MPL-2.0 or Apache-2.0. KOAN Plus distributes the
unmodified npm dependency under the Apache-2.0 option; both license texts
supplied by the package are retained in the generated notices.

## Inline icons

The interface includes inline SVG icons from or adapted from
[Lucide](https://github.com/lucide-icons/lucide), including icons originating in
[Feather](https://github.com/feathericons/feather). These are embedded in
`src/App.tsx` and `src/ThemeToggle.tsx`, rather than installed as an npm package.
Their ISC and MIT notices are preserved in [licenses/lucide.txt](./licenses/lucide.txt)
and included in the generated distribution notices.

The notice was retrieved from the [upstream license](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
on 2026-09-05. The upstream icon licenses apply to the icons; the project MIT
license does not replace them. When adding or updating third-party assets,
record their origin and preserve the corresponding notices here.

## 日本語

本体のMITライセンスと、依存ライブラリ・アイコンのライセンスを区別します。
ビルド時に各依存関係のライセンス原文を集め、配布用ディレクトリとZIPへ同梱します。
アイコンなどnpm以外から取り込む素材も、出典とライセンスをこの文書に記録してください。

# Repository Guidelines

## Project Structure & Module Organization

KOAN Plus is a local-only Chrome extension built with Vite, React, and TypeScript. Application code lives in `src/`: `App.tsx` is the main dashboard UI, `Onboarding.tsx` handles first-run consent, and domain modules such as `koan.ts`, `cle.ts`, `auth.ts`, and `storage.ts` contain data fetching, authentication, and persistence logic. Shared styling is in `src/styles.css`.

Extension entry files and static assets are split between `public/`, root manifests, and `assets/`. The root `manifest.json` is a loader guard; the production extension is generated into `dist/`. Build and release helpers live in `scripts/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies. Use Node.js `20.19+` or `22.12+`.
- `npm run dev`: start the Vite development server.
- `npm run build`: sync manifests, type-check with `tsc -b`, and build `dist/`.
- `npm run preview`: serve the built output for inspection.
- `npm run zip`: build and package the extension ZIP from `dist/`.
- `npm version <patch|minor|major>`: runs the manifest sync hook and stages manifest updates.

Do not commit generated output such as `dist/`, `node_modules/`, ZIP files, or `*.tsbuildinfo`.

## Coding Style & Naming Conventions

Use strict TypeScript and React function components. Follow the existing two-space indentation, double-quoted imports, semicolon style, and `react-jsx` JSX transform. Prefer explicit exported types for shared domain data and keep browser-storage keys centralized in `src/storage.ts`. Name React components in `PascalCase`, functions and variables in `camelCase`, constants in `UPPER_SNAKE_CASE` only when they represent fixed configuration values.

## Testing Guidelines

There is currently no dedicated automated test suite. For every change, run `npm run build` as the minimum verification because it performs manifest sync, TypeScript validation, and Vite bundling. When changing KOAN, CLE, authentication, or storage behavior, manually load `dist/` in Chrome via `chrome://extensions` and verify the affected workflow. Add future tests near the relevant source module, using `*.test.ts` or `*.test.tsx` naming.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`. This repository also requires Japanese commit messages. Keep commits focused and include generated manifest changes when version or description metadata changes.

Pull requests should summarize the user-visible change, list verification steps such as `npm run build`, link related issues, and include screenshots for UI changes. For security-sensitive changes, do not expose secrets, credentials, or private university-system details in issues or PRs; follow `SECURITY.md`.

## Agent-Specific Instructions

At the start of work in this Git repository, run `git status` and then `git pull --rebase` unless the current branch has no upstream. At the end, commit and push any changes; do not report completion unless `git status` is clean and the push succeeds.

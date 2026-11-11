# Contributing

Thanks for helping with HiveLab 合屋. 欢迎提交 Issue 和 Pull Request。

## Set up

Windows 10 / 11 x64, Git, and Node.js 26 (npm 12 needs `^22.22.2`, `^24.15.0` or `>=26.0.0`).

```powershell
npm ci
npm run dev
```

`npm run dev` builds the app and opens it with its data in the project's `.hivelab` folder, separate from any installed copy. See [docs/development.md](docs/development.md) and [docs/technical.md](docs/technical.md) for the architecture and project conventions.

## Before you open a pull request

```powershell
npm run typecheck
npm test
```

`npm run verify` also runs the interface and desktop smoke tests and takes much longer; run it for changes that touch windows, startup, the file preview or packaging. All tests use temporary signed-out profiles and never call a real model. Do not add tests that need a real account.

## Conventions

- **Interface text is a Chinese source string wrapped in `t()`**, and every new string needs an English entry under `src/renderer/locales/en/`. `tests/i18n.test.ts` fails when one is missing. Prompts sent to members stay in Chinese on purpose.
- **Animation**: do not add anything that completes instantly; follow [docs/design-optimization-guide.md](docs/design-optimization-guide.md) and [docs/ui-layers.md](docs/ui-layers.md). Judge motion from a real screen recording, not from Playwright frames.
- **Safety**: never auto-resend a request whose delivery is unknown, never write outside an authorised folder, never put secrets in logs or snapshots.
- Keep changes small and focused, with a test where the behaviour can be tested.
- Commit messages follow `type(scope): summary` (for example `fix(desk): ...`, `feat(ui): ...`, `docs: ...`).

## Artwork and media

Do not add third-party artwork, music or video unless its license allows redistribution, and record the source in `ATTRIBUTION.md`. The built-in member artwork has its own terms, described there.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Do not open a public issue for them.

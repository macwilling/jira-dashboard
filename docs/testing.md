# Testing

The project uses [Vitest](https://vitest.dev/) for unit and component tests.

## Running

```bash
npm test            # run once
npm run test:watch  # watch mode
npm run test:ui     # Vitest UI
npm run test:coverage
```

## Layout & conventions

- **Config:** `vitest.config.mts`. It must be `.mts`, not `.ts` — the package is
  CommonJS (`package.json` has no `"type": "module"`) and `vite-tsconfig-paths`
  ships as ESM-only, so a `.ts` config fails to load.
- **Path alias:** `@/*` resolves through `vite-tsconfig-paths`, matching
  `tsconfig.json`, so tests import with the same `@/...` specifiers as app code.
- **Location:** tests are colocated with the code they cover, named
  `*.test.ts(x)`.
- **Fixtures:** shared builders live in `test/fixtures.ts` (e.g. `makeTicket`,
  `makeComment`). Prefer these over hand-rolling objects so a schema change only
  needs updating in one place.

## Environments

The default environment is `node` — fast, and correct for the bulk of the code,
which is pure functions. A test that needs a DOM (rendering a React component)
opts in per-file with a pragma on the very first line:

```ts
// @vitest-environment jsdom
```

Component tests use `@testing-library/react`; the `@testing-library/jest-dom`
matchers (`toBeInTheDocument`, etc.) are registered globally in
`vitest.setup.ts`. `test/dom-smoke.test.tsx` is a minimal example.

## What's covered today

Pure logic that's cheap to test and high-value to protect:

- `lib/jira/mappers.ts` — ADF→Markdown conversion + priority/type/status mapping
- `app/wallboard/stages.ts` — Jira status → display stage
- `app/wallboard/feed.ts` — snapshot diffing, comment previews, relative time
- `lib/utils.ts` — staleness, epic colors, summary-tag parsing, standup time
- `lib/releases/matcher.ts` — release-name parsing + date math

## Where to extend next

The release pipeline is the area with the most real-world blast radius and the
least coverage. Good next targets, roughly in priority order:

1. `lib/releases/orchestrator.ts` — the idempotency and category-conflict logic.
   Will need the D1 client and the Slack/Google dispatchers mocked (`vi.mock`).
2. `lib/releases/resolution.ts` / `merge-fields.ts` — mostly pure, testable now.
3. Slack `lib/slack/signing.ts` — signature verification is security-sensitive
   and pure.

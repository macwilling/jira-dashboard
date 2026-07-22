# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jira Standup Viewer — a Next.js 14 (App Router) dashboard for facilitating scrum standups, tracking story progress, automating release checklists, and routing support requests. Fetches tickets from Jira Cloud and integrates with Cloudflare (KV + D1), Slack, Google (Tasks/Calendar), Freshdesk, GitHub, and AWS S3. Built with TypeScript, Tailwind CSS, and shadcn/ui components.

## Commands

- `npm run dev` — Start development server
- `npm run build` — Production build
- `npm run lint` — ESLint
- `node --env-file=.env.local scripts/apply-migrations.mjs` — Apply additive D1 migrations (idempotent; checks `PRAGMA table_info` before each `ALTER`)
- `npm test` — Run the unit test suite once (Vitest)
- `npm run test:watch` — Vitest in watch mode
- `npm run test:coverage` — Run with a V8 coverage report

### Testing

Vitest is the test runner. Config lives in `vitest.config.mts` (must be `.mts` — the package is CommonJS and `vite-tsconfig-paths` is ESM-only); the `@/*` path alias is resolved via `vite-tsconfig-paths`. Tests are colocated next to source as `*.test.ts` / `*.test.tsx`. The default environment is `node`; a test that needs the DOM opts in with a `// @vitest-environment jsdom` pragma on the first line and uses `@testing-library/react` (jest-dom matchers are registered in `vitest.setup.ts`). Shared fixtures (e.g. `makeTicket`) live in `test/fixtures.ts`. See `docs/testing.md`.

Current coverage: Jira mappers (ADF→Markdown, priority/type/status mapping), wallboard stage + feed-diff logic, shared utils, the release-name parser, and the release **orchestrator** (`handleVersionEvent` control flow — every dependency mocked via `vi.mock`, so the branching is asserted in isolation). The D1-backed stores and the Slack/Google dispatchers are still uncovered — good next targets.

CI runs lint, typecheck (`tsc --noEmit`), tests, and a production build on every push to `main` and every PR — see `.github/workflows/ci.yml`.

The Cloudflare cron worker in `cron/` is a **separate npm package** with its own `package.json`. Deploy it with `wrangler deploy` from inside `cron/` (see `cron/README.md`).

## Architecture

### Data Flow (standup dashboard)

```
SWR (5min poll) → /api/jira/tickets → Jira Cloud REST API
                                      ├── searchAllIssues(jqlFilter)
                                      ├── fetchEpicColors (Agile API)
                                      └── mapJiraIssue (ADF → Markdown)
```

### Storage layers

- **Cloudflare KV** (`lib/config.ts`, via Upstash-style REST API) — dashboard configuration: JQL filter, board ID, sprint field ID, L2 label patterns.
- **Cloudflare D1** (`lib/d1/client.ts`, via the D1 REST API) — relational store for the release pipeline. Used because the app runs on Vercel where a native D1 binding isn't available. Schema lives in `migrations/` (numbered SQL files, applied in order).

### Jira layer

- **`app/api/jira/`** — Server-side API routes that proxy Jira Cloud (Basic Auth). Endpoints: `tickets`, `issues`, `search`, `attachment`, `changelog`, `epic-children`.
- **`lib/jira/client.ts`** — Jira HTTP client; credential handling, issue creation, and ADF document builders (`adfDoc`, `adfParagraph`, `adfHeading`, etc.) used by the Slack support flow.
- **`lib/jira/mappers.ts`** — Converts Jira responses to app types. Includes ADF (Atlassian Document Format) → Markdown/HTML conversion, status category mapping, epic color resolution.
- **`lib/jira/versions.ts`** — Project version fetching, used by the release pipeline and cron recovery.
- **`lib/jira/types.ts`** / **`lib/types.ts`** — Jira API response types / app-level types.
- **`lib/ticket-data-context.tsx`** — React Context + SWR provider for global ticket/team/sprint state. Falls back to mock data (`lib/mock-data.ts`) when unconfigured.

### Pages

- `/` — Main standup dashboard (client component)
- `/changes`, `/risks` — Standup-support views (recent ticket changes, at-risk tickets)
- `/releases`, `/releases/workflows`, `/releases/categories`, `/releases/task-library` — Release pipeline + config; see `docs/release-flow.md`
- `/github` — PR statistics (heatmap / by-contributor / over-time)
- `/wallboard` — full-screen TV dashboard (no AppShell chrome): story-grouped momentum sprint board (subtasks attach to stories via `Ticket.parentKey`; Jira statuses map to display stages in `app/wallboard/stages.ts` — Resolved="Code Review", unknown="Done"), change feed with toasts/ding, GitHub PR KPIs (`/api/github/prs/summary`), Datadog RUM insights (`/api/datadog/insights`, `lib/datadog/client.ts`). Polls tickets every 60s (shares the provider's SWR cache key), stats every 5 min; change detection is a client-side snapshot diff (`app/wallboard/feed.ts`)
- `/files` — S3 file upload + public-link sharing
- `/settings` — Configuration UI for JQL filter, L2 labels, sprint field

App chrome lives in `components/app-shell/` (`AppShell`, `AppNav`, `AppTopBar`, `TicketBrowseShell`).

### Release Management (`/releases`)

Automated release checklist pipeline. See `docs/release-flow.md` for the full end-to-end flow with mermaid diagram. **Keep that doc in sync when modifying `lib/releases/`, `app/api/webhooks/jira/version/`, `app/api/webhooks/slack/interactive/`, or `app/api/releases/`.**

Flow: Jira version webhook → D1 → category resolution → workflow matching → task instance generation → (optional) Slack approval gate → dispatch to Google Tasks / Calendar → Slack notifications.

- **`lib/releases/orchestrator.ts`** — Single entry point `handleVersionEvent`. Handles delete/upsert, category resolution, category-change conflict detection, task generation, date cascade, approval gate, lifecycle notifications. Idempotent — safe to replay.
- **Workflows model** (refactored; see `docs/workflows-refactor-handoff.md`) — A *workflow* groups tasks + notifications and is matched to a release by *category* (parsed from the version name). Key stores: `workflows-store.ts`, `categories.ts`, `task-definitions-store.ts` (reusable task library), `task-instances-store.ts` (materialization with locks/overrides), `events-store.ts` (append-only audit log).
- **Cron recovery** — `app/api/cron/recover/route.ts` reconciles Jira's versions against D1 and replays missed webhook events. Driven by the `cron/` Cloudflare worker every 5 min.

### Slack support intake

Slack slash command → modal flow that files Jira issues (and links Freshdesk tickets).

- `app/api/slack/command/route.ts` — slash command entry; verifies Slack signature, opens the request-type modal.
- `app/api/webhooks/slack/interactive/route.ts` — handles modal submissions / interactive components.
- `lib/slack/support-modals.ts` — Block Kit modal view builders; `lib/slack/support-handlers.ts` — submission handlers that create Jira issues.
- `lib/slack/signing.ts` — verifies `x-slack-signature`.
- `lib/freshdesk/client.ts` — fetches/searches Freshdesk tickets to pre-fill modals.

### Other integrations

- **`lib/google/client.ts`** + `app/api/auth/google/` — Google OAuth; Tasks + Calendar for release task dispatch.
- **`lib/github/client.ts`** + `app/api/github/prs/` — GitHub PR stats (classic PAT, repo scope, read-only).
- **AWS S3** (`@aws-sdk/client-s3`) — backs `/files`; presigned URLs for a public-read bucket.
- **Read AI → Obsidian meeting notes** (`app/api/webhooks/readai/route.ts`, `app/api/readai/enrich/route.ts`, `lib/readai/`, `lib/google/drive.ts`) — receives Read AI meeting-completed webhooks (HMAC-verified via `X-Read-Signature`, KV-deduped on `request_id`), then **deterministically** builds the meeting note + companion transcript file (`lib/readai/note.ts`: template, attendee wikilinks, Jira-key links, previous-in-series link) and writes them to the Obsidian vault's Google Drive folders (ids pinned in `lib/readai/vault.ts`; update-in-place via a KV `session_id` → file-id mapping). It then fires a claude.ai routine (Sonnet, `lib/readai/routine.ts`) with the transcript + a vault-note menu + an HMAC callback token; the routine POSTs key decisions / action-item owners / related-note wikilinks to `/api/readai/enrich`, which patches the note's `<!-- enrich:… -->` marker blocks. Note write is the critical path (502 → Read AI retries); enrichment is best-effort. Requires the Google OAuth connection to include the Drive scope.

### UI Components

- **`components/TicketDrawer.tsx`** — Largest component; side drawer with ADF-rendered descriptions, linked tickets, attachments.
- **`components/TeamCard.tsx`** — Per-member card with grouped ticket rows.
- **`components/SearchBar.tsx`** — Command palette (`cmdk`) with `/` keyboard shortcut.
- **`components/ui/`** — shadcn/ui primitives (do not modify directly; regenerate via shadcn CLI).

## Conventions

- Path alias: `@/*` maps to the project root (e.g., `@/lib/utils`, `@/components/ui/button`).
- Styling: Tailwind CSS with CSS variables for theming (dark mode supported). Use `cn()` from `lib/utils.ts` for class merging.
- Component variants use `class-variance-authority` (cva).
- Icons: Lucide React (`lucide-react`).
- shadcn config in `components.json` uses `base-nova` style.
- D1 schema changes: add a new numbered file in `migrations/`; additive `ALTER`s should be guarded so `apply-migrations.mjs` stays idempotent.

## Environment Variables

Required/optional in `.env.local` (see `.env.example` for the full annotated list):

- `JIRA_URL`, `NEXT_PUBLIC_JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` — Jira Cloud (Basic Auth).
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_NAMESPACE_ID`, `CLOUDFLARE_D1_DATABASE_ID` — Cloudflare KV (config) + D1 (release store).
- `JIRA_WEBHOOK_SECRET`, `CRON_RECOVERY_SECRET`, `JIRA_PROJECT_KEY` — webhook ingestion + cron recovery.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (Tasks + Calendar).
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` — Slack notifications + interactive components.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` — `/files` page.
- `FRESHDESK_DOMAIN`, `FRESHDESK_API_KEY` — Freshdesk support-ticket lookups.
- `READAI_WEBHOOK_SIGNING_KEY` (or `READAI_WEBHOOK_SECRET` fallback), `CLAUDE_ROUTINE_ID`, `CLAUDE_ROUTINE_TOKEN` — Read AI webhook → Claude routine bridge.
- `GITHUB_TOKEN` — `/github` PR stats + `/wallboard` PR KPIs.
- `DATADOG_ACCESS_TOKEN` (PAT, preferred) or `DATADOG_API_KEY` + `DATADOG_APP_KEY` (+ optional `DATADOG_SITE`, `DATADOG_RUM_APP_ID`, `DATADOG_RUM_USER_FIELD`) — `/wallboard` RUM product insights.
- `NEXT_PUBLIC_APP_URL` — public origin, used in Slack "View in app" links and the interactive Request URL.

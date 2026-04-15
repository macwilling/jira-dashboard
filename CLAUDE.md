# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jira Standup Viewer — a Next.js 14 (App Router) dashboard for facilitating scrum standups. Fetches tickets from Jira Cloud, groups them by team member and status, and displays sprint progress. Built with TypeScript, Tailwind CSS, and shadcn/ui components.

## Commands

- `npm run dev` — Start development server
- `npm run build` — Production build
- `npm run lint` — ESLint

No test framework is configured.

## Architecture

### Data Flow

```
SWR (5min poll) → /api/jira/tickets → Jira Cloud REST API
                                      ├── searchAllIssues(jqlFilter)
                                      ├── fetchEpicColors (Agile API)
                                      └── mapJiraIssue (ADF → Markdown)
```

### Key Layers

- **`app/api/jira/`** — Server-side API routes that proxy Jira Cloud (Basic Auth). Endpoints: `tickets`, `issues`, `search`, `attachment`, `epic-children`.
- **`lib/jira/client.ts`** — Jira HTTP client with credential handling.
- **`lib/jira/mappers.ts`** — Converts Jira responses to app types. Includes ADF (Atlassian Document Format) → Markdown/HTML conversion, status category mapping, and epic color resolution.
- **`lib/jira/types.ts`** — Jira API response type definitions.
- **`lib/types.ts`** — App-level types (Ticket, TeamMember, Sprint).
- **`lib/ticket-data-context.tsx`** — React Context + SWR provider for global ticket/team/sprint state. Falls back to mock data when unconfigured.
- **`lib/config.ts`** — Dashboard configuration stored in Cloudflare KV (via Upstash REST API). Stores JQL filter, board ID, sprint field ID, L2 label patterns.

### UI Components

- **`components/TicketDrawer.tsx`** — Largest component; side drawer showing full ticket details with ADF-rendered descriptions, linked tickets, and attachments.
- **`components/TeamCard.tsx`** — Per-member card with grouped ticket rows.
- **`components/SearchBar.tsx`** — Command palette (`cmdk`) with `/` keyboard shortcut.
- **`components/ui/`** — shadcn/ui primitives (do not modify directly; regenerate via shadcn CLI).

### Progress Page (`/progress`)

A PM-facing view for tracking story-level progress and identifying blockers. See `docs/progress-page.md` for full details.

- **`lib/progress-utils.ts`** — Builds flat `StoryCard[]` from sprint tickets. Reconstructs Story→Task hierarchy from Jira issue links (not parent/child — tasks are *linked* to stories via inconsistent link types). Uses heuristic: any non-blocking link between a Story and a Task = child relationship.
- **`components/progress/`** — `StoryCard`, `TaskChipBadge`, `FilterBar`, `MiniProgressBar`.
- **Sprint-aware clustering** — If any ticket in a story's cluster (the story or any linked task) is in the sprint, the entire story appears with all its tasks.
- **Enriched link data** — `TicketLinkDef` includes `targetType`, `targetSummary`, `targetStatus`, `targetStatusCategory`, `rawDescription`. This lets us show task chips for linked tickets not in the sprint without extra API calls.
- **Scope toggle** — `/api/jira/tickets?scope=all-open` overrides JQL to fetch all non-closed issues across the project.

### Release Management (`/releases`)

Automated release checklist pipeline: Jira version webhooks → D1 → template matching → task instance generation → (optional) Slack approval gate → dispatch to Google Tasks / Calendar → Slack notifications. See `docs/release-flow.md` for the full end-to-end flow with mermaid diagram. **Keep that doc in sync when modifying any file under `lib/releases/`, `app/api/webhooks/jira/version/`, `app/api/webhooks/slack/interactive/`, or `app/api/releases/`.**

### Pages

- `/` — Main dashboard (client component)
- `/progress` — Story progress view with filters (scope, fix version, epic)
- `/releases` — Release list + per-release task dispatch status
- `/releases/templates`, `/releases/task-library` — Template + task library config
- `/settings` — Configuration UI for JQL filter, L2 labels, sprint field

## Conventions

- Path alias: `@/*` maps to the project root (e.g., `@/lib/utils`, `@/components/ui/button`)
- Styling: Tailwind CSS with CSS variables for theming (dark mode supported). Uses `cn()` from `lib/utils.ts` for class merging.
- Component variants use `class-variance-authority` (cva).
- Icons: Lucide React (`lucide-react`).
- shadcn config in `components.json` uses `base-nova` style.

## Environment Variables

Required in `.env.local` (see `.env.example`):
- `JIRA_URL`, `NEXT_PUBLIC_JIRA_URL` — Jira Cloud instance URL
- `JIRA_EMAIL`, `JIRA_API_TOKEN` — Jira Basic Auth credentials
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_NAMESPACE_ID` — Cloudflare KV for config storage

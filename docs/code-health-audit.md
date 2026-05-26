# Code Health Audit

_Date: 2026-05-19_

A cohesion, bloat, and performance audit of the codebase, which has grown from
"Jira standup viewer" into five loosely-joined feature areas. This is a
maintainability review — security is covered separately.

## Feature-area status (read this first)

Findings below are triaged against the real state of each area. Don't invest
cleanup effort in code that is about to be deleted or rewritten.

| Area | Status | Cleanup worth it? |
|---|---|---|
| `/` main dashboard, `TicketDrawer`, `lib/jira`, `ticket-data-context` | **Active / core** | Yes |
| `/progress`, `/risks` | **Abandoned** — and ticket structure is changing | No — defer or delete |
| `/changes` | **Unfinished** | Only when revived |
| `/releases` (+ `lib/releases`, cron worker) | **Unfinished** | Only when revived |
| `/github` | **Unfinished** | Only when revived |

## The core problem

The app grew into five products without ever growing a shared infrastructure
layer. Each new feature copied the scaffolding of the last. Individual files
are clean and well-commented — the problem is *the same code 5–40 times over*:

- **5 integration clients** (Jira, Slack, Google, Freshdesk, GitHub) each
  hand-roll HTTP fetch, credential reading, and error formatting.
- **~40 API routes** each reinvent config guards, secret verification, and
  error-response shape — with divergent HTTP status codes for identical
  conditions (a "not configured" feature returns 503, 500, 400, or a silent
  200 depending on which route you hit).
- **6 D1 stores** each re-implement row-mapping, JSON parsing, ID generation,
  and dynamic-UPDATE building.

The fix is mostly extract-and-reuse, not rewrites — low risk, since the
duplicated blocks are provably identical. Note there is no test suite as a
safety net.

## Performance: honest assessment

Most audit findings are **maintainability, not speed**. Of the performance
items, only one produces a user-noticeable improvement:

### Worth doing — the one real win

**Main dashboard fetch path** (`/api/jira/tickets` + `fetchEpicColors`).
This is the live product's hot path, hit on every load and every 5-minute SWR
poll, by every connected client.

- `fetchEpicColors` makes **one Jira Agile API call per distinct epic** (chunked
  10-concurrent). A sprint touching 15 epics = 15 upstream calls before the
  dashboard can render.
- The route has **no caching directive at all** — 3–4 standup attendees = 3–4×
  the entire fan-out against Jira.
- Epic colors are effectively static.

**Fix:** cache epic colors (in-process `Map` with a multi-hour TTL, or KV) and
add `export const revalidate = 60` to the route. Expected: faster cold load,
and upstream Jira load drops to ~once/minute regardless of client count.
**Low effort, genuinely noticeable.**

Secondary, smaller: the ticket payload ships every ticket's full ADF-converted
`description` and all `comments` to the client, though list views only need
summary/status. A lighter list payload + lazy drawer fetch would speed initial
load — but it's medium effort and ticket structure is in flux, so defer.

### Not worth chasing for speed

- **`/api/releases` N+1 (61 D1 queries).** Sounds alarming, but the queries run
  concurrently — wall-clock ≈ one round-trip. It's a cost/quota concern, not
  latency. And Releases is unfinished. Skip until that feature is revived.
- **Orchestrator / dispatcher / task-materialization round-trips.** All
  background work behind webhooks — no user ever waits on it.
- **All consolidation/refactor work** — zero runtime impact; maintainability
  only.
- **Unmemoized filters in `RisksView`** — negligible, and the page is abandoned.

**Bottom line:** fix the dashboard fetch path. Everything else perf-labelled is
either background work nobody waits on, or in abandoned/unfinished pages.

## Cohesion findings

### Shared infrastructure layer (the highest-leverage consolidation)

| Create | Replaces |
|---|---|
| `lib/http.ts` — `apiFetch()` with uniform ok-check + error format | ~25 hand-rolled fetch/throw blocks; ~150 lines in `google/client.ts` alone |
| `lib/api/` — `requireJira()` / `requireSlack()` / `requireS3()` guards, `jsonError()`, `parseJson()` | Per-route config checks returning 503/500/400/silent-200 inconsistently |
| `lib/cloudflare/kv.ts` + `lib/env.ts` | `getCfKvConfig`/`kvUrl` duplicated verbatim in `config.ts` & `google/client.ts`; `getCredentials()` copy-pasted 5× |
| `lib/releases/store-helpers.ts` — `parseJsonObject`, `newId`, `boolFromInt`, `nowIso`, `buildUpdate()` | 6 stores reinventing row-mapping; ~200–300 lines |

The value of this layer is "the next 5 features cost less." It only pays back
if the unfinished features (Releases, Changes, GitHub) are actually going to be
finished. If they stay shelved, build only the parts the live dashboard
touches (`lib/jira` consolidation) and skip the rest.

### Duplicated UI (mostly in abandoned/unfinished areas — defer)

- **3 parallel progress bars** (`MiniProgressBar`, `EpicProgressBar`,
  `SprintProgressBar`) sharing copy-pasted color maps. Only `SprintProgressBar`
  is on the live dashboard — consolidation mostly benefits abandoned pages.
- **`ChangesView` / `RisksView`** are structurally cloned. Both
  unfinished/abandoned — leave until revived.
- **"Summary tags" JSX block duplicated in 9 files** → one `<SummaryTags>`
  component. This one *does* touch live files (`TicketDrawer`, `TicketRow`,
  `SearchBar`) — worth doing.
- **`components/states/`** — `LoadingState` / `ErrorState` / `EmptyState`,
  currently re-coded per page.

### Monolithic files

`TicketDrawer.tsx` is **1,069 lines** — and it's core, on the live dashboard,
and will keep being edited. Worth decomposing: split sub-sections into
siblings, move helpers to `lib/`, extract the 3 inline fetches into a
`useTicketDetail(key)` hook.

The release pages (`app/releases/[id]/page.tsx` 1,272 lines, and three more at
600–1,234) are equally monolithic but unfinished — decompose them as part of
finishing the feature, not before.

### Correctness note — lower priority than first thought

`getActiveBlockers()` is defined identically in 3 files (`progress-utils`,
`risks-utils`, `standup-changes-utils`). Originally flagged as a correctness
risk if Jira link types shift — but two of those three files back
abandoned/unfinished pages, so the blast radius is small. Consolidate into
`lib/ticket-links.ts` only when those pages are revived.

### Dead code (safe quick deletes)

- `resetApproval` (`lib/releases/approval.ts`) — zero callers.
- `adfParagraphWithLink` (`lib/jira/client.ts`) — unused.
- `onStatusChange` — plumbed through the entire ticket component tree, every
  handler a documented no-op. Implement status mutation or remove the plumbing.

## Recommended sequencing

Re-prioritized for the reality that `/progress` and `/risks` are abandoned and
Changes/Releases/GitHub are unfinished.

**Do now — touches the live product:**
1. Epic-color cache + `revalidate` on `/api/jira/tickets`. _The one noticeable
   perf win._
2. Decompose `TicketDrawer.tsx`. Core, large, actively edited.
3. `<SummaryTags>` component + `lib/jira` client consolidation (`apiFetch`).
4. Delete the dead code listed above.

**Defer until the owning feature is revived:**
- The full `lib/api/` guard layer and `store-helpers.ts` — build alongside
  finishing Releases/Changes/GitHub.
- `ChangesView`/`RisksView` and progress-bar consolidation.
- `/api/releases` N+1 and the orchestrator D1 round-trips.

**Probably skip:**
- Cohesion cleanup in `/progress` and `/risks`. Abandoned, and ticket structure
  is changing — that code may be deleted or rewritten. Don't polish it.

## Open decision

Phase 2 above hinges on one question: **are Releases, Changes, and GitHub going
to be finished, or shelved?** If finished, the shared infrastructure layer pays
back fast and should be built as you complete them. If shelved indefinitely,
skip it — and consider deleting the abandoned `/progress` and `/risks` code
rather than carrying it.

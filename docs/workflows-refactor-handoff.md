# Workflows Refactor — Handoff

Branch: `workflows-refactor`

Status: **all phases complete.** Server pipeline, resolution flow, cron recovery, admin UIs (workflows + categories + task library), release detail banners, and the refreshed architecture doc are all in. Merge candidate pending a live verification pass.

> Historical note preserved below. The "Next-session pickup" section is superseded by the [Completion notes](#completion-notes) at the bottom.

## What's done

- **Phase 1** — branch created, schema audited.
- **Phase 2** — `migrations/0012_workflows_refactor.sql` written (destructive: drops old template tables, creates workflow/category/events, seeds 6 categories unassigned).
- **Phase 3** — new core libs:
  - `lib/releases/types.ts` — `Workflow`, `WorkflowTask`, `WorkflowNotification`, `ReleaseCategory`, updated `Release` with `categoryId` + `resolution*`, `ReleaseEvent` (audit), updated `ReleaseTaskInstance` (workflow FKs).
  - `lib/releases/categories.ts` — parse name + lookup category.
  - `lib/releases/workflows-store.ts` — CRUD for workflows, tasks, notifications.
  - `lib/releases/task-definitions-store.ts` — unchanged library CRUD, moved out of old templates-store.
  - `lib/releases/task-instances-store.ts` — materialization (library resolution + locks + overrides), CRUD, `countInstancesByState` for resolution snapshots.
  - `lib/releases/events-store.ts` — append-only audit log.
  - `lib/releases/admin-notifier.ts` — Slack resolution alert with 3 buttons.
  - `lib/releases/orchestrator.ts` — single entry point `handleVersionEvent`. Handles delete, upsert, category resolution, category-change conflict detection (freezes + snapshots + notifies), task generation, date cascade, approval gate, lifecycle notifications.
  - `lib/releases/approval.ts` — rewritten to take workflow; removed `isApprovalGateEnabled` (target comes from workflow now).
  - `lib/releases/notifications.ts` — reads rules from release → category → workflow instead of matching templates.
  - `lib/releases/store.ts` — new release columns (`categoryId`, `resolutionRequired`, `resolutionReason`, `resolutionSnapshot`), new mutators (`setReleaseCategory`, `setResolutionRequired`, `clearResolution`).
  - `lib/config.ts` — renamed `releaseApprovalSlackTarget` → `releaseAdminSlackTarget` (purpose broadened to admin alerts).
  - Dead files deleted: `lib/releases/templates-store.ts`, `lib/releases/notifications-store.ts`.
- **Phase 4** — `app/api/webhooks/jira/version/route.ts` is now a thin auth + parse + delegate handler.
- **Post-work** — every API route under `app/api/releases/**` had its imports updated. `app/api/releases/templates/**` deleted. `app/api/releases/route.ts`, `app/api/releases/[id]/route.ts`, `app/api/releases/[id]/tasks/route.ts`, `app/api/releases/[id]/tasks/[taskId]/dispatch/route.ts`, `app/api/releases/[id]/tasks/[taskId]/push-to-google/route.ts` rewritten to use the workflow model.
- **UI** — `app/releases/templates/**` deleted (will be replaced by `/releases/workflows` and `/releases/categories`).
- **Build-green pass (this commit)** — `app/releases/[id]/page.tsx` and `app/releases/page.tsx` patched to consume the new API shape (`{ release, category, workflow, expectedTaskCount, taskInstances, syncSummary }` for detail; `workflow` + `category` embedded on each release in the list). `matchedTemplates` state replaced with `category` + `workflow`. Template chip/empty-states now distinguish three UI cases: no category matched, category matched but no workflow assigned, or both present. Also fixed two ride-along blockers: unused `previousDate` in `lib/releases/orchestrator.ts:101` and stale `releaseApprovalSlackTarget` → `releaseAdminSlackTarget` references in `app/api/config/route.ts` and `app/settings/page.tsx`. **Settings UI label still says "Release Approval"** — the backing field is now admin-alerts only (approval is per-workflow). Label change deferred to Phase 9.

## What's still missing

1. **Workflows + Categories admin UI** — Phase 6. Doesn't exist yet. `/releases/workflows` (list + editor) and `/releases/categories` (assignment table) need to be built, along with their API routes. See Phase 6 in "Next-session pickup" below. The old "Templates" link in `components/app-shell/AppNav.tsx` still points at `/releases/templates` which returns 404 — leave until the new pages land, then replace.

2. **Release detail — unmatched + resolution banners** — Phase 7. The detail page now *degrades gracefully* when `release.categoryId` is null (shows "No category matched") or when the category has no workflow ("Category X has no workflow — assign one"), but there's no prominent banner for the `resolutionRequired` freeze state. The detail page just continues to render task rows even though the orchestrator has short-circuited generation. Needs explicit banner + three resolution cards per the snapshot.

3. **Resolve endpoint + Slack interactive wiring** — Phase 8. `app/api/releases/[id]/resolve/route.ts` does not exist; Slack interactive handler does not yet wire the resolution action IDs from `admin-notifier.ts`.

4. **Cloudflare cron recovery** — Phase 5. Not started.

5. **Admin-target relabel + polish** — Phase 9. Settings UI still says "Release Approval" over a field that's now `releaseAdminSlackTarget` (used for admin-notifier alerts only). Relabel + copy refresh pending.

## The migration

`migrations/0012_workflows_refactor.sql` is the **only** schema change needed. Destructive. Drops `release_templates`, `release_template_tasks`, `release_template_notifications`, recreates `releases` + `release_task_instances` with new FKs, creates `workflow`, `workflow_tasks`, `workflow_notifications`, `release_category`, `release_events`. Seeds 6 categories (web-major/minor/patch + android-major/minor/patch) with `workflow_id = NULL`.

User was going to apply this in the Cloudflare D1 console while I coded. **Verify it was applied** before doing anything else on this branch — running the new server code against the old schema will fail loudly.

## Next-session pickup

**Start here**: Phase 6. Everything before it is done.

Suggested order (each can be a separate commit):

### 1. Phase 6 — workflows + categories UI

- New `app/releases/workflows/page.tsx` (list + create) and `app/releases/workflows/[id]/page.tsx` (editor: name, approval Slack target, task list, notification rules).
  - Reuse `components/releases/MergeFieldPicker.tsx` and `SlackTargetPicker.tsx`.
  - Task list editor: pick from task library (with library task indicator) or add inline.
  - Notification rules: event type dropdown + message + target + buttons.
- New `app/releases/categories/page.tsx` — table of the 6 seeded categories with a workflow dropdown per row (or "unassigned"). Save calls `setCategoryWorkflow()`.
- API: `app/api/releases/workflows/route.ts` (GET list, POST create), `app/api/releases/workflows/[id]/route.ts` (GET/PUT/DELETE + tasks + notifications — can pattern-match the old templates route that was deleted), `app/api/releases/categories/route.ts` (GET list, PATCH assignment).
- Update navigation: `components/app-shell/AppShell.tsx` — replace "Templates" link with "Workflows" and "Categories" (or nest under a "Releases" section).

### 2. Phase 7 — release detail banners

- Unmatched banner on `/releases/[id]` when `release.categoryId === null`, explaining that the name didn't parse and linking to the categories page.
- Resolution banner when `release.resolutionRequired === true` — replace task table with three cards (Keep original / Switch to new / Discard), populated from `release.resolutionSnapshot`. Each card has a confirmation-on-click button.

### 3. Phase 8 — category-change resolution flow

- `app/api/releases/[id]/resolve/route.ts` — POST with body `{ action: "keep_original" | "switch_workflow" | "discard" }`.
  - `keep_original` — clear `resolutionRequired`, leave category pointing at the old one (set via snapshot), write audit event.
  - `switch_workflow` — delete remote Google resources for non-completed tasks, clear non-dispatched instances (`clearNonDispatchedInstances`), call `generateTaskInstances` with the new workflow, clear `resolutionRequired`, re-trigger approval gate via `applyApprovalOrDispatch` if the new workflow has a target, write audit event.
  - `discard` — delete remote Google resources for non-completed tasks, clear all non-completed instances, clear category, clear `resolutionRequired`, write audit event.
- Wire Slack interactive handler: `app/api/webhooks/slack/interactive/route.ts` — add action IDs from `admin-notifier.ts` (`RESOLUTION_KEEP_ORIGINAL_ACTION` etc.). Each action does the same work as the POST endpoint + updates the original Slack message in place with the outcome ("Switched to X by @user"). Ephemeral confirmation already built into the Slack blocks.
- Test: rename a release mid-dispatch in Jira and verify Slack message appears and each button path works.

### 4. Phase 5 — Cloudflare cron recovery

- Cloudflare Worker (separate from Next.js app) with `[triggers] crons = ["*/5 * * * *"]`. Polls Jira for active versions in the project, diffs against D1, and POSTs to `/api/webhooks/jira/version` for drift. Free on Cloudflare's free tier.
- Alternative: Vercel cron calling the same handler. Only works on Pro plan with sub-daily frequency.

### 5. Phase 9 — polish

- Unified `/api/releases/[id]/actions` endpoint (collapse approve/cancel/refresh/purge/resolve).
- Approval Slack message shows task preview (`lib/releases/approval-message.ts`).
- Update `docs/release-flow.md` to reflect the new model (replace template-matching section with category lookup, update mermaid diagram, update file map).

## Data shape gotchas

- `Release.categoryId` is nullable — a release can exist before matching a category.
- `Release.resolutionRequired` is an in-band flag. When true, the orchestrator short-circuits generation/cascade/dispatch. Only the resolve endpoint clears it.
- `ResolutionSnapshot` captures both old and new context so the UI doesn't need to re-resolve. It includes `taskCounts` at the moment the conflict was detected — those counts may drift over time (user can complete a task in Google), so re-count at resolve time before showing the final confirm.
- `approval_slack_target` on the workflow being null = no gate. Empty string shouldn't occur (trimmed at store boundary).
- `workflow_tasks.definition_id` nullable = inline task; non-null = library-linked with locks.
- `release_category` has `UNIQUE(platform_prefix, release_type)` — attempts to create overlapping categories will fail at the DB layer.

## Architecture doc

`docs/release-flow.md` was written against the OLD model. It is stale until Phase 9 updates it. If you're orienting someone to the current (after-this-branch-merges) model, point them at this handoff doc plus the code; update the release-flow doc as part of Phase 9.

## Tasks in the tracker

- [x] #1 Phase 1: feature branch + schema audit
- [x] #2 Phase 2: D1 schema reset
- [x] #3 Phase 3: orchestrator + core libs
- [x] #4 Phase 4: webhook route becomes thin handler
- [x] #5 Phase 5: Cloudflare cron recovery
- [x] #6 Phase 6: workflows + categories UI
- [x] #7 Phase 7: release detail — unmatched + resolution banner
- [x] #8 Phase 8: category-change resolution flow
- [x] #9 Phase 9: rename admin target + polish

## Completion notes

- **Phase 6** — `/releases/workflows` (list + editor) and `/releases/categories` built. API: `app/api/releases/workflows/route.ts`, `app/api/releases/workflows/[id]/route.ts`, `app/api/releases/categories/route.ts`. Nav in `components/app-shell/AppNav.tsx` updated: Templates link replaced by Workflows / Categories / Task library. The old `/releases/templates` path is dead.
- **Phase 7** — Unmatched banner and resolution banner + 3-card decision UI added in `app/releases/[id]/page.tsx`. When `resolutionRequired`, the task list is replaced with the cards so it's clear the release is frozen.
- **Phase 8** — `/api/releases/[id]/resolve` endpoint + Slack interactive action IDs wired. Shared logic in `lib/releases/resolution.ts`. Slack side updates the original message in place with the outcome.
- **Phase 5** — `app/api/cron/recover/route.ts` diffs Jira's version list against D1 and replays orchestrator events. Separate Cloudflare Worker at `cron/` on a 5-min schedule calls it. New env vars: `CRON_RECOVERY_SECRET` (app + worker), `JIRA_PROJECT_KEY` (app), `APP_URL` (worker).
- **Phase 9** — Settings UI "Release Approval" relabeled to "Release Admin Alerts" with copy that explains per-workflow approval is configured on each workflow. `docs/release-flow.md` fully rewritten against the new model (new mermaid, new file map, new text).

## Deployment checklist

Before merging `workflows-refactor` to `main`:

1. Run `migrations/0012_workflows_refactor.sql` in Cloudflare D1 (destructive — drops old template tables).
2. Set new env vars in Vercel: `CRON_RECOVERY_SECRET`, `JIRA_PROJECT_KEY`.
3. Deploy the cron worker in `cron/`: set `APP_URL` var and `CRON_RECOVERY_SECRET` secret, then `wrangler deploy`.
4. On first release after deploy, verify: category resolution writes the right `category_id`, task generation respects the assigned workflow, approval Slack target comes from the workflow (not KV).
5. Re-point the Slack app's Interactivity Request URL if your deploy host changed — the new resolution buttons reuse that endpoint.

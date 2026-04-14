/**
 * Derives a SyncState for a task instance from its stored fields.
 *
 * The model: this app is a webhook-driven dispatcher. Google Tasks / Calendar
 * is the source of truth for whether work is "done"; the UI just reports how
 * the local dispatch record compares to Google.
 *
 * Error prefixes are written by the dispatcher (MISSING: / DRIFT:) so the UI
 * can show richer sync states without a schema migration.
 */

import type { ReleaseTaskInstance } from "./types";

export type SyncState =
  | "manual"           // actionType === "manual" — no sync
  | "pending"          // dispatchable, not yet dispatched, no error
  | "failed"           // dispatch attempted and failed; no external ref
  | "synced"           // dispatched and last check saw it in Google
  | "missing"          // was dispatched, now gone from Google
  | "drifted";         // in Google but date/time diverged from expected

export function computeSyncState(i: ReleaseTaskInstance): SyncState {
  if (i.actionType === "manual") return "manual";

  const err = i.lastDispatchError;
  if (err?.startsWith("MISSING:")) return "missing";
  if (err?.startsWith("DRIFT:")) return "drifted";
  if (err) return i.externalId ? "drifted" : "failed";

  return i.externalId ? "synced" : "pending";
}

export interface SyncSummary {
  total: number;
  synced: number;
  pending: number;
  failed: number;
  missing: number;
  drifted: number;
  manual: number;
}

export function summarizeSyncStates(instances: ReleaseTaskInstance[]): SyncSummary {
  const s: SyncSummary = {
    total: instances.length,
    synced: 0,
    pending: 0,
    failed: 0,
    missing: 0,
    drifted: 0,
    manual: 0,
  };
  for (const i of instances) {
    s[computeSyncState(i)]++;
  }
  return s;
}

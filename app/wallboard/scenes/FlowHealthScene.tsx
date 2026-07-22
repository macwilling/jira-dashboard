"use client";

/**
 * Flow Health — the "why isn't this moving?" scene. Built entirely on the
 * shared ticket cache the wallboard already polls, plus a bounded changelog
 * fetch to get accurate time-in-current-status for the few tickets that
 * matter (blocked + in-flight). No new integration.
 *
 * Surfaces: blocked & at-risk work, aging WIP (stuck in one status too long),
 * and work-in-progress per person (overload detection).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTicketData } from "@/lib/ticket-data-context";
import { ChangelogEntry, Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ACCENT, MetricTile, Panel, StageChip, stageOf } from "./ui";
import type { SceneAlert } from "./types";

const HOUR = 3_600_000;
const AGING_THRESHOLD_H = 72; // in one status ≥ 3 days = aging
const OVERLOAD = 4; // > 4 in-flight items for one person = overloaded
const IN_FLIGHT = new Set(["In Progress", "Code Review", "Testing"]);
const MAX_CHANGELOG = 16; // cap changelog fetches per refresh

/** Tickets on the sprint board (mirrors the Sprint Board scene's filter). */
function sprintScope(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.inSprint ?? !t.isL2);
}

function isBlocked(t: Ticket): boolean {
  return stageOf(t.status) === "Blocked";
}
function isInFlight(t: Ticket): boolean {
  return IN_FLIGHT.has(stageOf(t.status));
}
function fmtDur(h: number): string {
  if (h < 1) return "<1h";
  if (h < 24) return `${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.floor(h % 24);
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

/**
 * Fetches the changelog for the given ticket keys (bounded) and returns a map
 * of key → epoch ms the ticket entered its CURRENT status. Falls back silently
 * to lastActivityDate at the call site when a key is missing.
 */
function useStatusEnteredAt(keys: string[]): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  const sig = keys.join(",");
  const lastSig = useRef<string>("");

  useEffect(() => {
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (keys.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        keys.slice(0, MAX_CHANGELOG).map(async (key) => {
          try {
            const res = await fetch(
              `/api/jira/changelog?key=${encodeURIComponent(key)}`
            );
            if (!res.ok) return [key, undefined] as const;
            const data = await res.json();
            const log = (data.changelog ?? []) as ChangelogEntry[];
            // Entries are newest-first; the first status change is the moment
            // the ticket entered its current status.
            const entry = log.find((e) =>
              e.changes.some((c) => c.field.toLowerCase() === "status")
            );
            const at = entry ? new Date(entry.created).getTime() : undefined;
            return [key, at] as const;
          } catch {
            return [key, undefined] as const;
          }
        })
      );
      if (cancelled) return;
      const next = new Map<string, number>();
      for (const [key, at] of entries) if (at !== undefined) next.set(key, at);
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [sig, keys]);

  return map;
}

/**
 * Alert probe used by the kiosk to cut in when work is blocked. Cheap — reads
 * only the shared ticket cache (no changelog), so it's safe to run always.
 */
export function useFlowAlert(): SceneAlert | null {
  const { tickets } = useTicketData();
  const blocked = useMemo(
    () => sprintScope(tickets).filter(isBlocked),
    [tickets]
  );
  if (blocked.length === 0) return null;
  const now = Date.now();
  const worst = [...blocked].sort(
    (a, b) =>
      new Date(a.lastActivityDate).getTime() -
      new Date(b.lastActivityDate).getTime()
  )[0];
  const age = fmtDur((now - new Date(worst.lastActivityDate).getTime()) / HOUR);
  const label =
    blocked.length === 1
      ? `${worst.key} blocked · ${age}`
      : `${blocked.length} blocked · ${worst.key} ${age}`;
  return { level: "critical", label };
}

interface PersonWip {
  id: string;
  name: string;
  avatarUrl: string;
  count: number;
  blocked: number;
}

export default function FlowHealthScene() {
  const { tickets: all, teamMembers } = useTicketData();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now ?? Date.now();

  const tickets = useMemo(() => sprintScope(all), [all]);
  const memberMap = useMemo(() => {
    const m = new Map<string, { name: string; avatarUrl: string }>();
    for (const p of teamMembers) m.set(p.id, p);
    return m;
  }, [teamMembers]);

  const blocked = useMemo(() => tickets.filter(isBlocked), [tickets]);
  const inFlight = useMemo(() => tickets.filter(isInFlight), [tickets]);

  // Time-in-status only matters for blocked + in-flight work; fetch just those.
  const watchKeys = useMemo(
    () =>
      [...blocked, ...inFlight]
        .sort(
          (a, b) =>
            new Date(a.lastActivityDate).getTime() -
            new Date(b.lastActivityDate).getTime()
        )
        .map((t) => t.key),
    [blocked, inFlight]
  );
  const enteredAt = useStatusEnteredAt(watchKeys);

  const statusAgeH = useMemo(() => {
    const f = (t: Ticket) =>
      (nowMs - (enteredAt.get(t.key) ?? new Date(t.lastActivityDate).getTime())) /
      HOUR;
    return f;
  }, [enteredAt, nowMs]);

  const aging = useMemo(
    () =>
      inFlight
        .filter((t) => statusAgeH(t) >= AGING_THRESHOLD_H)
        .sort((a, b) => statusAgeH(b) - statusAgeH(a)),
    [inFlight, statusAgeH]
  );

  // At-risk feed: blocked first (longest-blocked first), then aging WIP.
  const atRisk = useMemo(() => {
    const b = [...blocked].sort((a, c) => statusAgeH(c) - statusAgeH(a));
    return [...b, ...aging];
  }, [blocked, aging, statusAgeH]);

  const oldestInFlightH = useMemo(
    () => (inFlight.length ? Math.max(...inFlight.map(statusAgeH)) : 0),
    [inFlight, statusAgeH]
  );

  const people = useMemo<PersonWip[]>(() => {
    const map = new Map<string, PersonWip>();
    for (const t of inFlight) {
      const id = t.assigneeId || "unassigned";
      const m = memberMap.get(id);
      const p =
        map.get(id) ??
        map
          .set(id, {
            id,
            name: m?.name ?? "Unassigned",
            avatarUrl: m?.avatarUrl ?? "",
            count: 0,
            blocked: 0,
          })
          .get(id)!;
      p.count += 1;
    }
    for (const t of blocked) {
      const id = t.assigneeId || "unassigned";
      const p = map.get(id);
      if (p) p.blocked += 1;
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [inFlight, blocked, memberMap]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.7em]">
      {/* stat strip */}
      <div className="grid shrink-0 grid-cols-4 gap-[0.55em]">
        <MetricTile
          label="Blocked"
          value={blocked.length}
          tone={blocked.length > 0 ? "bad" : "good"}
        />
        <MetricTile
          label="Aging WIP (≥3d in status)"
          value={aging.length}
          tone={aging.length > 0 ? "warn" : "good"}
        />
        <MetricTile label="In flight" value={inFlight.length} tone="accent" />
        <MetricTile
          label="Oldest in flight"
          value={inFlight.length ? fmtDur(oldestInFlightH) : "—"}
          tone={oldestInFlightH >= AGING_THRESHOLD_H ? "warn" : undefined}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-[0.7em]">
        {/* at-risk feed */}
        <Panel
          title={`Blocked & at risk — ${atRisk.length}`}
          className="flex-[1.4]"
          dotColor="#f85149"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-[0.35em] overflow-y-auto wallboard-noscrollbar">
            {atRisk.length === 0 && (
              <span className="text-[0.68em] text-muted-foreground">
                Nothing blocked and nothing aging — flow is clean. ✨
              </span>
            )}
            {atRisk.map((t) => {
              const member = memberMap.get(t.assigneeId);
              const blk = isBlocked(t);
              return (
                <div
                  key={t.key}
                  className={cn(
                    "flex items-center gap-[0.5em] rounded-md border px-[0.55em] py-[0.4em]",
                    blk
                      ? "border-red-500/40 bg-red-500/[0.07]"
                      : "border-amber-500/30 bg-amber-500/[0.05]"
                  )}
                >
                  <span
                    className="shrink-0 font-mono text-[0.6em] font-bold"
                    style={{ color: ACCENT }}
                  >
                    {t.key}
                  </span>
                  <StageChip status={t.status} />
                  <span className="min-w-0 flex-1 truncate text-[0.64em]">
                    {t.summary}
                  </span>
                  {member && (
                    <Avatar className="h-[1.3em] w-[1.3em] shrink-0">
                      <AvatarImage src={member.avatarUrl} alt={member.name} />
                      <AvatarFallback className="text-[0.5em]">
                        {member.name.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-right text-[0.58em] font-semibold tabular-nums",
                      blk ? "text-red-400" : "text-amber-400"
                    )}
                  >
                    {blk ? "blocked" : "in status"} {fmtDur(statusAgeH(t))}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* WIP per person */}
        <Panel
          title="Work in progress by person"
          className="flex-1"
          dotColor={ACCENT}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-[0.4em] overflow-y-auto wallboard-noscrollbar">
            {people.length === 0 && (
              <span className="text-[0.68em] text-muted-foreground">
                No active work in progress.
              </span>
            )}
            {people.map((p) => {
              const overloaded = p.count > OVERLOAD;
              return (
                <div key={p.id} className="flex items-center gap-[0.5em]">
                  <Avatar className="h-[1.5em] w-[1.5em] shrink-0">
                    <AvatarImage src={p.avatarUrl} alt={p.name} />
                    <AvatarFallback className="text-[0.5em]">
                      {p.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-[0.64em]">
                    {p.name}
                  </span>
                  {p.blocked > 0 && (
                    <span className="shrink-0 rounded bg-red-500/15 px-[0.4em] py-[0.05em] text-[0.5em] font-bold text-red-400">
                      {p.blocked} blocked
                    </span>
                  )}
                  {/* WIP dots — filled up to count, red past the overload line */}
                  <div className="flex shrink-0 items-center gap-[0.15em]">
                    {Array.from({ length: Math.max(p.count, 1) }).map((_, i) => (
                      <span
                        key={i}
                        className="h-[0.5em] w-[0.5em] rounded-full"
                        style={{
                          background:
                            i >= OVERLOAD ? "#f85149" : ACCENT,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className={cn(
                      "w-[1.5em] shrink-0 text-right text-[0.64em] font-bold tabular-nums",
                      overloaded ? "text-red-400" : "text-foreground"
                    )}
                  >
                    {p.count}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

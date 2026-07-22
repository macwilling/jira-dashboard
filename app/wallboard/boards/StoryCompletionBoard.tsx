"use client";

/**
 * Static per-story completion board for the all-day ambient wallboard. One row
 * per root work item (Story / Task / Bug / Design); subtasks fold into their
 * parent as a segmented progress bar. Roots with no subtasks show their own
 * status pill instead of a bar (a story with no subtasks isn't "0% done").
 * Fully-done work — including the many closed roll-off tickets — collapses to a
 * single count so it never dominates. No auto-scroll: at normal sprint size the
 * list fits, and overflow is itself a signal.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckCircle2 } from "lucide-react";
import { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import { STAGE_COLORS } from "../stages";
import { IDLE_BADGE_H, StoryRow, buildStoryRows, fmtAgo } from "./board-data";

interface Props {
  tickets: Ticket[];
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  highlightKeys: Set<string>;
}

export default function StoryCompletionBoard({
  tickets,
  nowMs,
  avatarOf,
  highlightKeys,
}: Props) {
  const { active, doneCount } = useMemo(
    () => buildStoryRows(tickets, nowMs),
    // nowMs ticks every second; only the idle/moved flags depend on it — recompute per minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, Math.floor(nowMs / 60_000)]
  );

  // Slide rows to their new spot when the sort order changes (a fresh edit
  // floats its story to the top), so the move is visible rather than a jump.
  const listRef = useRef<HTMLDivElement>(null);
  useFlipReorder(listRef, active.map((r) => r.ticket.key).join("|"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-[0.3em] overflow-hidden"
      >
        {active.length === 0 && (
          <span className="text-[0.7em] text-muted-foreground">
            Nothing in flight.
          </span>
        )}
        {active.map((row) => (
          <StoryRowView
            key={row.ticket.key}
            row={row}
            avatarOf={avatarOf}
            // Pulse the story when it, OR any of its subtasks, just changed.
            highlighted={
              highlightKeys.has(row.ticket.key) ||
              row.subs.some((s) => highlightKeys.has(s.key))
            }
          />
        ))}
      </div>

      <div className="mt-[0.5em] flex shrink-0 items-center gap-[1.1em] border-t pt-[0.45em] text-[0.55em] text-muted-foreground">
        {doneCount > 0 && (
          <span className="flex items-center gap-[0.35em] font-semibold">
            <CheckCircle2
              className="h-[1.1em] w-[1.1em]"
              style={{ color: STAGE_COLORS.Done }}
            />
            {doneCount} done this sprint
          </span>
        )}
        <span className="ml-auto flex items-center gap-[0.85em]">
          <LegendDot stage="Done" label="done" />
          <LegendDot stage="Testing" label="testing" />
          <LegendDot stage="Code Review" label="review" />
          <LegendDot stage="In Progress" label="in progress" />
          <LegendDot stage="Blocked" label="blocked" />
          <LegendDot stage="To Do" label="to do" />
        </span>
      </div>
    </div>
  );
}

/**
 * FLIP reorder animation: when the ordered set of rows changes, each row that
 * moved starts at its previous on-screen position and slides to its new one.
 * Runs only when the order key changes (not on the per-second clock tick).
 */
function useFlipReorder(
  containerRef: React.RefObject<HTMLElement>,
  orderKey: string
) {
  const prevTops = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodes = Array.from(
      el.querySelectorAll<HTMLElement>("[data-flip-key]")
    );
    const nextTops = new Map<string, number>();
    for (const node of nodes) {
      const key = node.dataset.flipKey!;
      const top = node.getBoundingClientRect().top;
      nextTops.set(key, top);
      const old = prevTops.current.get(key);
      if (old === undefined) continue;
      const dy = old - top;
      if (Math.abs(dy) < 1) continue;
      // Invert to the old position instantly, then play to the new one.
      node.style.transition = "none";
      node.style.transform = `translateY(${dy}px)`;
      void node.offsetHeight; // force reflow so the start frame registers
      requestAnimationFrame(() => {
        node.style.transition = "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = "";
      });
    }
    prevTops.current = nextTops;
  }, [containerRef, orderKey]);
}

function LegendDot({
  stage,
  label,
}: {
  stage: keyof typeof STAGE_COLORS;
  label: string;
}) {
  return (
    <span className="flex items-center gap-[0.3em]">
      <span
        className="h-[0.6em] w-[0.6em] rounded-[2px]"
        style={{ background: STAGE_COLORS[stage] }}
      />
      {label}
    </span>
  );
}

function StoryRowView({
  row,
  avatarOf,
  highlighted,
}: {
  row: StoryRow;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  highlighted: boolean;
}) {
  const { ticket, hasSubs, done, total, pct, rootStage, blocked } = row;
  const member = avatarOf(ticket.assigneeId);
  const stalled = row.started && !row.moved && row.idleH >= IDLE_BADGE_H;
  const stageColor = STAGE_COLORS[rootStage];

  // Fixed grid columns so key / summary / meta / avatar / progress line up on
  // the same vertical rails across every row, regardless of what each contains.
  return (
    <div
      data-flip-key={ticket.key}
      className={cn(
        "grid shrink-0 items-center gap-[0.6em] rounded-md border-l-[0.2em] py-[0.36em] pl-[0.6em] pr-[0.6em]",
        row.started ? "bg-white/[0.02]" : "opacity-60",
        highlighted && "wallboard-glow"
      )}
      style={{
        gridTemplateColumns: "4.6em 2.4em minmax(0,1fr) 4.6em 1.5em 12.5em",
        borderLeftColor: blocked ? STAGE_COLORS.Blocked : "rgba(255,255,255,0.08)",
      }}
    >
      {/* 1 · key (muted — a reference, not the headline) */}
      <span className="truncate font-mono text-[0.6em] font-semibold text-foreground/45">
        {ticket.key}
      </span>

      {/* 2 · type tag (empty slot for stories keeps summaries aligned) */}
      {ticket.type !== "Story" ? (
        <span className="justify-self-start rounded bg-white/[0.06] px-[0.4em] py-[0.03em] text-[0.46em] font-bold uppercase tracking-wide text-muted-foreground">
          {ticket.type}
        </span>
      ) : (
        <span />
      )}

      {/* 3 · summary */}
      <span className="min-w-0 truncate text-[0.7em]">{ticket.summary}</span>

      {/* 4 · movement (single aligned slot) */}
      <span className="justify-self-end text-[0.5em] font-bold whitespace-nowrap">
        {row.moved ? (
          <span className="text-green-400">▲ moved</span>
        ) : stalled ? (
          <span className="text-amber-400/90">idle {fmtAgo(row.idleH)}</span>
        ) : null}
      </span>

      {/* 5 · assignee */}
      {member ? (
        <Avatar className="h-[1.3em] w-[1.3em]">
          <AvatarImage src={member.avatarUrl} alt={member.name} />
          <AvatarFallback className="text-[0.5em]">
            {member.name.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <span />
      )}

      {/* 6 · completion — bar for roots with subtasks, else a status pill.
             Both fill this fixed cell and share the same right edge. */}
      {hasSubs ? (
        <div className="flex items-center gap-[0.5em]">
          <div className="flex h-[0.5em] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            {row.segments.map((seg) => (
              <div
                key={seg.stage}
                style={{
                  width: `${(seg.count / total) * 100}%`,
                  background: STAGE_COLORS[seg.stage],
                }}
                title={`${seg.count} ${seg.stage}`}
              />
            ))}
          </div>
          <span className="w-[2.6em] shrink-0 text-right text-[0.55em] tabular-nums text-foreground/60">
            {done}/{total}
          </span>
          <span className="w-[2.3em] shrink-0 text-right text-[0.66em] font-bold tabular-nums">
            {pct}%
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <span
            className="rounded px-[0.5em] py-[0.12em] text-[0.56em] font-semibold whitespace-nowrap"
            style={{ background: `${stageColor}22`, color: stageColor }}
          >
            {rootStage}
          </span>
        </div>
      )}
    </div>
  );
}

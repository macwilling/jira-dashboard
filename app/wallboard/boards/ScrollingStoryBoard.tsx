"use client";

/**
 * The original wallboard sprint board: story-grouped cards with subtask chips,
 * an epic tag, a per-group progress bar, and gentle auto-scroll when the list
 * overflows. Preserved as a self-contained component for the planned
 * multi-page wallboard. `scrollToKey` (via ref) brings a board item into view
 * when a notification fires and holds the scroll there.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FeedEvent, relativeTime } from "../feed";
import { Stage, STAGE_COLORS, stageOf } from "../stages";
import {
  ACCENT,
  IDLE_BADGE_H,
  StoryGroup,
  fmtAgo,
  groupByStory,
  groupPct,
  hasMoved,
  hoursSince,
  idleHours,
  movedCount,
} from "./board-data";

const TOAST_MS = 12_000;

export interface ScrollingStoryBoardHandle {
  scrollToKey: (key: string) => void;
}

interface Props {
  tickets: Ticket[];
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  lastTransition: Map<string, FeedEvent>;
  highlightKeys: Set<string>;
}

/**
 * Gently auto-scrolls a container when its content overflows: pause at the
 * top, drift down slowly, pause at the bottom, glide back up, repeat. Does
 * nothing while everything fits. Returns a controller whose `scrollToKey`
 * brings the element with the matching data-wbkey into view and holds the
 * auto-scroll there while a notification is up.
 */
function useAutoScroll(ref: React.RefObject<HTMLDivElement>) {
  const ctrl = useRef<{ scrollToKey: (key: string) => void }>({
    scrollToKey: () => {},
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const DOWN_SPEED = 16; // px/s while reading downward
    const UP_SPEED = 120; // px/s on the return trip
    let dir = 1;
    let pos = 0;
    let raf = 0;
    let last = performance.now();
    let pauseUntil = last + 5_000;

    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4) {
        pos = 0;
        el.scrollTop = 0;
      } else if (t >= pauseUntil) {
        pos = Math.min(Math.max(pos, 0), max);
        pos += dir * (dir > 0 ? DOWN_SPEED : UP_SPEED) * dt;
        el.scrollTop = pos;
        if (dir > 0 && pos >= max - 1) {
          dir = -1;
          pauseUntil = t + 3_000;
        } else if (dir < 0 && pos <= 1) {
          dir = 1;
          pauseUntil = t + 5_000;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    ctrl.current.scrollToKey = (key: string) => {
      const target = el.querySelector<HTMLElement>(
        `[data-wbkey="${CSS.escape(key)}"]`
      );
      if (!target) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4) return;
      // Land the item ~30% from the top of the panel
      const targetTop =
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop -
        el.clientHeight * 0.3;
      pos = Math.min(Math.max(targetTop, 0), max);
      el.scrollTo({ top: pos, behavior: "smooth" });
      dir = 1;
      pauseUntil = performance.now() + TOAST_MS + 2_000;
    };

    return () => cancelAnimationFrame(raf);
  }, [ref]);
  return ctrl;
}

const ScrollingStoryBoard = forwardRef<ScrollingStoryBoardHandle, Props>(
  function ScrollingStoryBoard(
    { tickets, nowMs, avatarOf, lastTransition, highlightKeys },
    ref
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollCtrl = useAutoScroll(scrollRef);
    useImperativeHandle(ref, () => ({
      scrollToKey: (key) => scrollCtrl.current.scrollToKey(key),
    }));

    const { activeGroups, collapsedGroups } = useMemo(
      () => groupByStory(tickets, nowMs),
      // nowMs changes every second; only re-group on the minute
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tickets, Math.floor(nowMs / 60_000)]
    );

    return (
      <div
        ref={scrollRef}
        className="wallboard-noscrollbar flex min-h-0 flex-1 flex-col gap-[0.45em] overflow-y-auto"
      >
        {activeGroups.map((g) => (
          <StoryCard
            key={g.story?.key ?? "other-work"}
            group={g}
            nowMs={nowMs}
            avatarOf={avatarOf}
            lastTransition={lastTransition}
            highlightKeys={highlightKeys}
          />
        ))}
        {collapsedGroups.map((g) => (
          <div
            key={g.story!.key}
            className="flex shrink-0 items-center gap-[0.5em] px-[0.6em] opacity-50"
          >
            <span
              className="shrink-0 whitespace-nowrap font-mono text-[0.6em] font-bold"
              style={{ color: ACCENT }}
            >
              {g.story!.key}
            </span>
            <StageChip status={g.story!.status} />
            <span className="truncate text-[0.62em] text-muted-foreground">
              {g.story!.summary} — all {g.subs.length || ""} subtasks done
            </span>
            {g.story!.epicName && (
              <span
                className="max-w-[9em] shrink-0 truncate rounded-full border px-[0.55em] py-[0.1em] text-[0.5em] font-semibold uppercase tracking-wide"
                style={{
                  color: g.story!.epicColor ?? "hsl(var(--muted-foreground))",
                  borderColor: `${g.story!.epicColor ?? "#888"}55`,
                  background: `${g.story!.epicColor ?? "#888"}14`,
                }}
              >
                {g.story!.epicName}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
);

export default ScrollingStoryBoard;

function StageChip({ status }: { status: string }) {
  const stage = stageOf(status);
  const c = STAGE_COLORS[stage];
  return (
    <span
      className="shrink-0 rounded px-[0.4em] py-[0.05em] text-[0.55em] font-semibold whitespace-nowrap"
      style={{ background: `${c}22`, color: c }}
    >
      {stage}
    </span>
  );
}

function MoveBadge({ group, nowMs }: { group: StoryGroup; nowMs: number }) {
  const n = movedCount(group, nowMs);
  if (n > 0) {
    return (
      <span className="shrink-0 rounded bg-green-500/15 px-[0.45em] py-[0.08em] text-[0.52em] font-bold text-green-400 whitespace-nowrap">
        ▲ {n} moved
      </span>
    );
  }
  const idle = idleHours(group, nowMs);
  if (idle >= IDLE_BADGE_H) {
    return (
      <span className="shrink-0 rounded bg-amber-500/15 px-[0.45em] py-[0.08em] text-[0.52em] font-bold text-amber-400 whitespace-nowrap">
        idle {fmtAgo(idle)}
      </span>
    );
  }
  return <span className="shrink-0 text-[0.52em] text-muted-foreground/60">—</span>;
}

function StoryCard({
  group,
  nowMs,
  avatarOf,
  lastTransition,
  highlightKeys,
}: {
  group: StoryGroup;
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  lastTransition: Map<string, FeedEvent>;
  highlightKeys: Set<string>;
}) {
  const { story, subs } = group;
  const chips = subs.length > 0 ? subs : story ? [story] : [];
  const storyHighlighted = !!story && highlightKeys.has(story.key) && subs.length > 0;

  return (
    <div
      data-wbkey={story?.key}
      className={cn(
        "shrink-0 rounded-lg border px-[0.6em] py-[0.45em]",
        story ? "bg-white/[0.025]" : "border-dashed bg-transparent",
        storyHighlighted && "wallboard-glow"
      )}
    >
      <div className="flex min-w-0 items-center gap-[0.55em]">
        {story ? (
          <>
            <span
              className="shrink-0 whitespace-nowrap font-mono text-[0.62em] font-bold"
              style={{ color: ACCENT }}
            >
              {story.key}
            </span>
            <StageChip status={story.status} />
            <span className="min-w-0 flex-1 truncate text-[0.65em]">
              {story.summary}
            </span>
            {story.epicName && (
              <span
                className="max-w-[9em] shrink-0 truncate rounded-full border px-[0.55em] py-[0.1em] text-[0.5em] font-semibold uppercase tracking-wide"
                style={{
                  color: story.epicColor ?? "hsl(var(--muted-foreground))",
                  borderColor: `${story.epicColor ?? "#888"}55`,
                  background: `${story.epicColor ?? "#888"}14`,
                }}
                title={story.epicName}
              >
                {story.epicName}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[0.58em] font-semibold uppercase tracking-widest text-muted-foreground">
            Other work
          </span>
        )}
        <MoveBadge group={group} nowMs={nowMs} />
        <span className="min-w-[2.4em] shrink-0 text-right text-[0.6em] tabular-nums text-muted-foreground">
          {story ? `${groupPct(group)}%` : ""}
        </span>
      </div>

      <div className="mt-[0.35em] flex flex-wrap gap-[0.3em]">
        {chips.map((t) => (
          <SubChip
            key={t.key}
            ticket={t}
            nowMs={nowMs}
            avatarOf={avatarOf}
            transition={lastTransition.get(t.key)}
            highlighted={highlightKeys.has(t.key)}
          />
        ))}
      </div>

      {story && subs.length > 0 && (
        <div className="mt-[0.35em] flex h-[0.28em] overflow-hidden rounded-full bg-white/[0.06]">
          {(["Done", "Testing", "Code Review", "In Progress", "Blocked"] as Stage[]).map(
            (stage) => {
              const n = subs.filter((t) => stageOf(t.status) === stage).length;
              if (n === 0) return null;
              return (
                <div
                  key={stage}
                  style={{
                    width: `${(n / subs.length) * 100}%`,
                    background: STAGE_COLORS[stage],
                  }}
                />
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

function SubChip({
  ticket,
  nowMs,
  avatarOf,
  transition,
  highlighted,
}: {
  ticket: Ticket;
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  transition?: FeedEvent;
  highlighted?: boolean;
}) {
  const moved = hasMoved(ticket, nowMs);
  const ago = hoursSince(ticket.lastActivityDate, nowMs);
  const member = avatarOf(ticket.assigneeId);
  const stage = stageOf(ticket.status);
  const tip = transition
    ? `${transition.text} · ${relativeTime(transition.at, nowMs)}`
    : `${stage} · updated ${fmtAgo(ago)} ago`;

  return (
    <div
      data-wbkey={ticket.key}
      className={cn(
        "flex w-[16.5em] shrink-0 flex-col gap-[0.1em] rounded-md px-[0.5em] py-[0.3em] text-[0.62em]",
        moved || highlighted
          ? "bg-[#4493f8]/[0.13] shadow-[inset_0_0_0_1px_rgba(68,147,248,0.25)]"
          : "bg-white/[0.05] opacity-35",
        highlighted && "wallboard-glow"
      )}
      title={tip}
    >
      <div className="flex min-w-0 items-center gap-[0.45em]">
        <span className="shrink-0 font-mono font-bold" style={{ color: ACCENT }}>
          {ticket.key.replace(/^\w+-/, "")}
        </span>
        <span
          className="shrink-0 whitespace-nowrap text-[0.85em] font-bold"
          style={{ color: STAGE_COLORS[stage] }}
        >
          {stage}
        </span>
        {moved && (
          <span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold text-[#4493f8]">
            ↑{fmtAgo(ago)}
          </span>
        )}
        {member && (
          <Avatar className="ml-auto h-[1.4em] w-[1.4em] shrink-0">
            <AvatarImage src={member.avatarUrl} alt={member.name} />
            <AvatarFallback className="text-[0.55em]">
              {member.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className="truncate text-[0.92em] text-foreground/85">
        {ticket.summary}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Moon } from "lucide-react";
import { useSWRConfig } from "swr";

/**
 * Night mode: between 7 PM and 7 AM Eastern the wallboard swaps to a minimal
 * NightScreen and every poll is suspended (each SWR hook gets refreshInterval
 * 0 while `asleep`) — the board otherwise burns Vercel Active CPU all night
 * rendering for an empty room. Any key or a click/tap wakes it for
 * NIGHT_WAKE_MS with an immediate refetch of everything; Esc puts it back to
 * sleep early. At 7 AM it wakes on its own, also with a full refetch.
 */
const TZ = "America/New_York";
const SLEEP_START_HOUR = 19; // 7 PM ET
const WAKE_HOUR = 7; // 7 AM ET
/** How long a manual night wake keeps the board live before it re-sleeps. */
export const NIGHT_WAKE_MS = 30 * 60_000;

/** Wall-clock hour label for the night screen ("7:00 AM"). */
export const WAKE_LABEL = "7:00 AM";

// Module-level formatter — Intl.DateTimeFormat construction is expensive and
// this runs on every 1s clock tick.
const etHourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  hourCycle: "h23",
});

/** True when `ms` falls inside the 7 PM – 7 AM ET sleep window (DST-safe). */
export function inSleepWindow(ms: number): boolean {
  const h = Number(etHourFmt.format(ms));
  return h >= SLEEP_START_HOUR || h < WAKE_HOUR;
}

export function useNightMode(nowMs: number) {
  const { mutate, cache } = useSWRConfig();
  // A manual wake sets an expiry; until it passes the board stays live even
  // inside the sleep window.
  const [wakeUntil, setWakeUntil] = useState<number | null>(null);

  const inWindow = inSleepWindow(nowMs);
  const nightOverride = inWindow && wakeUntil !== null && nowMs < wakeUntil;
  const asleep = inWindow && !nightOverride;

  // Drop a spent or obsolete override so the next night starts asleep.
  useEffect(() => {
    if (wakeUntil !== null && (!inWindow || nowMs >= wakeUntil)) {
      setWakeUntil(null);
    }
  }, [inWindow, nowMs, wakeUntil]);

  // On every asleep→awake transition (manual wake OR the 7 AM rollover),
  // revalidate every cached key so the board comes back current instead of
  // showing 7 PM data until the next scheduled poll.
  const prevAsleep = useRef(asleep);
  useEffect(() => {
    if (prevAsleep.current && !asleep) {
      for (const key of cache.keys()) void mutate(key);
    }
    prevAsleep.current = asleep;
  }, [asleep, cache, mutate]);

  const wake = useCallback(() => {
    setWakeUntil(Date.now() + NIGHT_WAKE_MS);
  }, []);
  const sleepNow = useCallback(() => setWakeUntil(null), []);

  return {
    asleep,
    nightOverride,
    overrideRemainingMs: nightOverride && wakeUntil !== null ? wakeUntil - nowMs : 0,
    wake,
    sleepNow,
  };
}

/**
 * Full-screen sleep view: clock + date on near-black. The cluster drifts a
 * little on a slow cycle so a TV left on doesn't burn the time into one spot.
 */
export function NightScreen({
  nowMs,
  onWake,
}: {
  nowMs: number;
  onWake: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta")
        return;
      onWake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onWake]);

  const minutes = Math.floor(nowMs / 60_000);
  const driftX = Math.sin(minutes / 7) * 2.2;
  const driftY = Math.cos(minutes / 11) * 1.6;

  const time = new Date(nowMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const date = new Date(nowMs).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="dark fixed inset-0 z-50 flex cursor-default select-none flex-col items-center justify-center bg-black text-foreground"
      style={{ fontSize: "20px" }}
      onClick={onWake}
    >
      <div
        className="flex flex-col items-center gap-[0.6em] transition-transform duration-[3000ms] ease-in-out"
        style={{ transform: `translate(${driftX}em, ${driftY}em)` }}
      >
        <Moon className="h-[2em] w-[2em] text-slate-500/70" />
        <div className="text-[6em] font-semibold leading-none tabular-nums text-slate-300/90">
          {time}
        </div>
        <div className="text-[1.05em] text-slate-500">{date}</div>
        <div className="mt-[1.8em] text-[0.75em] text-slate-600">
          Asleep until {WAKE_LABEL} — any key wakes it for 30 minutes
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * KioskShell — the wallboard's rotation engine and persistent chrome.
 *
 * Owns everything that outlives a single scene: the full-screen frame, the
 * header (logo, clock, sound), the sound toggle + audio unlock, the fast
 * ticket poll, and the rotation itself. Scenes from the registry render into
 * the body; the shell cycles them, honors `?scene=`/`?kiosk=off` deep links,
 * lets a viewer pin one with the arrow keys, and cuts to a scene that raises a
 * critical alert (then resumes) — the "departures board" behavior.
 *
 * Scenes stay mounted and are toggled with visibility so their state and warm
 * data survive a rotation. (When heavier scenes join, gate their polling on an
 * active flag; with today's shared-cache Jira scenes the cost is negligible.)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useTicketData } from "@/lib/ticket-data-context";
import { cn } from "@/lib/utils";
import { SCENES } from "../scenes/registry";
import type { Scene, SceneAlert } from "../scenes/types";
import { isUnlocked, unlockOnGesture } from "../sound";
import { KioskProvider } from "./context";

const DWELL_DEFAULT = 40_000;
const CUT_IN_MS = 45_000;
const SOUND_KEY = "wallboard-sound";
const TICKETS_REFRESH_MS = 60_000;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.configured === false) {
      return { tickets: [], teamMembers: [], sprint: null, configured: false };
    }
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

/**
 * Invisible probe that runs a scene's `useAlert` even while the scene is off
 * screen, reporting changes up to the shell. One per registered scene that
 * defines an alert; the list is static so hook order stays stable.
 */
function AlertMonitor({
  scene,
  onReport,
}: {
  scene: Scene;
  onReport: (id: string, alert: SceneAlert | null) => void;
}) {
  const alert = scene.useAlert!();
  const sig = alert ? `${alert.level}:${alert.label}` : "";
  useEffect(() => {
    onReport(scene.id, alert);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

export default function KioskShell() {
  const enabled = useMemo(() => SCENES.filter((s) => s.enabled !== false), []);
  const n = enabled.length;
  const dwellOf = useCallback(
    (i: number) => enabled[i]?.dwellMs ?? DWELL_DEFAULT,
    [enabled]
  );

  const { configured } = useTicketData();

  // Keep the ticket cache fresh at kiosk cadence regardless of active scene.
  useSWR("/api/jira/tickets", fetcher, {
    refreshInterval: TICKETS_REFRESH_MS,
    revalidateOnFocus: false,
  });

  // ---- clock ----
  const [now, setNow] = useState<number | null>(null);
  const cycleStart = useRef<number>(0);
  useEffect(() => {
    const t = Date.now();
    setNow(t);
    cycleStart.current = t;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now ?? Date.now();

  // ---- sound (owned here, shared with scenes via context) ----
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    setSoundOn(localStorage.getItem(SOUND_KEY) !== "0");
    if (isUnlocked()) {
      setUnlocked(true);
      return;
    }
    return unlockOnGesture(() => setUnlocked(true));
  }, []);
  const toggleSound = () =>
    setSoundOn((s) => {
      localStorage.setItem(SOUND_KEY, s ? "0" : "1");
      return !s;
    });

  // ---- rotation state ----
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"auto" | "pinned">("auto");
  const [cutIn, setCutIn] = useState<{ index: number; until: number } | null>(
    null
  );

  const jumpTo = useCallback((i: number, pin: boolean) => {
    setIndex(i);
    if (pin) setMode("pinned");
    setCutIn(null);
    cycleStart.current = Date.now();
  }, []);

  // Deep links: ?scene=<id> pins a scene; ?kiosk=off freezes rotation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sceneId = params.get("scene");
    if (sceneId) {
      const i = enabled.findIndex((s) => s.id === sceneId);
      if (i >= 0) {
        setIndex(i);
        setMode("pinned");
        return;
      }
    }
    if (params.get("kiosk") === "off") setMode("pinned");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: ← → step + pin, space / p toggle auto-rotate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") jumpTo((index + 1) % n, true);
      else if (e.key === "ArrowLeft") jumpTo((index - 1 + n) % n, true);
      else if (e.key === " " || e.key.toLowerCase() === "p") {
        e.preventDefault();
        setMode((m) => (m === "auto" ? "pinned" : "auto"));
        setCutIn(null);
        cycleStart.current = Date.now();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, jumpTo]);

  // ---- alerts from scene monitors ----
  const [alerts, setAlerts] = useState<Map<string, SceneAlert | null>>(
    new Map()
  );
  const report = useCallback((id: string, alert: SceneAlert | null) => {
    setAlerts((prev) => {
      const next = new Map(prev);
      if (alert) next.set(id, alert);
      else next.delete(id);
      return next;
    });
  }, []);
  const monitored = useMemo(() => enabled.filter((s) => s.useAlert), [enabled]);
  const critical = enabled.find((s) => alerts.get(s.id)?.level === "critical");
  const warn = enabled.find((s) => alerts.get(s.id)?.level === "warn");
  const activeAlert = critical
    ? { scene: critical, alert: alerts.get(critical.id)!, level: "critical" as const }
    : warn
    ? { scene: warn, alert: alerts.get(warn.id)!, level: "warn" as const }
    : null;

  // Cut-in: a NEW critical alert (while auto-rotating) jumps to that scene and
  // holds for CUT_IN_MS, then rotation resumes. A chronic condition therefore
  // flashes once rather than freezing the board forever.
  const prevCrit = useRef<string>("");
  useEffect(() => {
    const label = critical
      ? `${critical.id}:${alerts.get(critical.id)?.label}`
      : "";
    if (label && label !== prevCrit.current && mode === "auto") {
      const ci = enabled.findIndex((s) => s.id === critical!.id);
      if (ci >= 0) {
        setCutIn({ index: ci, until: Date.now() + CUT_IN_MS });
        cycleStart.current = Date.now();
      }
    }
    prevCrit.current = label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [critical, alerts, mode]);

  const cutInActive = cutIn !== null && nowMs < cutIn.until && mode === "auto";
  const displayIndex = cutInActive ? cutIn!.index : index;
  const dwell = dwellOf(displayIndex);
  const paused = mode === "pinned";

  // Advance + expire cut-ins off the 1s clock (keeps progress in lockstep).
  useEffect(() => {
    if (now === null) return;
    if (cutIn && nowMs >= cutIn.until) {
      setCutIn(null);
      cycleStart.current = nowMs;
      return;
    }
    if (mode === "auto" && !cutInActive && n > 1) {
      if (nowMs - cycleStart.current >= dwell) {
        setIndex((i) => (i + 1) % n);
        cycleStart.current = nowMs;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMs]);

  const progress = paused
    ? 0
    : Math.min(1, Math.max(0, (nowMs - cycleStart.current) / dwell));

  return (
    <KioskProvider value={{ soundOn, soundUnlocked: unlocked }}>
      <div
        className="dark fixed inset-0 z-50 flex flex-col gap-[0.7em] overflow-hidden bg-background p-[0.8em] text-foreground"
        style={{ fontSize: "20px" }}
      >
        {/* ---- header / rotation chrome ---- */}
        <header className="flex shrink-0 items-center gap-[0.9em] px-[0.2em]">
          <h1 className="flex items-center gap-[0.45em] text-[1.35em] font-bold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.svg"
              alt="Mission Control"
              className="h-[1.15em] w-[1.15em]"
            />
            Mission Control
          </h1>
          {!configured && (
            <span className="text-[0.7em] text-amber-500">
              Jira not configured — showing demo data
            </span>
          )}

          {/* scene rail */}
          <nav className="ml-[0.6em] flex items-center gap-[0.4em]">
            {enabled.map((s, i) => {
              const active = i === displayIndex;
              return (
                <button
                  key={s.id}
                  onClick={() => jumpTo(i, true)}
                  className={cn(
                    "group relative flex items-center gap-[0.4em] overflow-hidden rounded-full border px-[0.7em] py-[0.28em] text-[0.6em] font-medium transition-colors",
                    active
                      ? "border-white/15 bg-white/[0.06] text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  title={s.source}
                  aria-current={active ? "true" : undefined}
                >
                  <span
                    className="h-[0.55em] w-[0.55em] shrink-0 rounded-full"
                    style={{
                      background: active ? s.accent : "currentColor",
                      opacity: active ? 1 : 0.5,
                    }}
                  />
                  {s.title}
                  {active && !paused && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-[2px] origin-left"
                      style={{
                        background: s.accent,
                        transform: `scaleX(${progress})`,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-[0.6em]">
            {activeAlert && (
              <span
                className={cn(
                  "flex items-center gap-[0.4em] rounded-full border px-[0.7em] py-[0.25em] text-[0.6em] font-semibold",
                  activeAlert.level === "critical"
                    ? "border-red-500/50 bg-red-500/10 text-red-400"
                    : "border-amber-500/50 bg-amber-500/10 text-amber-400"
                )}
              >
                <span
                  className={cn(
                    "h-[0.5em] w-[0.5em] rounded-full",
                    activeAlert.level === "critical"
                      ? "bg-red-500 kiosk-pulse"
                      : "bg-amber-500"
                  )}
                />
                {activeAlert.alert.label}
              </span>
            )}
            <button
              onClick={() =>
                setMode((m) => (m === "auto" ? "pinned" : "auto"))
              }
              className="text-muted-foreground transition-colors hover:text-foreground"
              title={paused ? "Resume rotation" : "Pause rotation"}
              aria-label={paused ? "Resume rotation" : "Pause rotation"}
            >
              {paused ? (
                <Play className="h-[0.9em] w-[0.9em]" />
              ) : (
                <Pause className="h-[0.9em] w-[0.9em]" />
              )}
            </button>
            {soundOn && !unlocked && (
              <span className="animate-pulse text-[0.55em] text-muted-foreground">
                click to enable sound
              </span>
            )}
            <button
              onClick={toggleSound}
              className="text-muted-foreground transition-colors hover:text-foreground"
              title={soundOn ? "Mute notifications" : "Unmute notifications"}
              aria-label={soundOn ? "Mute notifications" : "Unmute notifications"}
            >
              {soundOn ? (
                <Volume2 className="h-[1em] w-[1em]" />
              ) : (
                <VolumeX className="h-[1em] w-[1em]" />
              )}
            </button>
            <span className="text-[1.3em] font-semibold tabular-nums">
              {now === null
                ? "--:--"
                : new Date(now).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
            </span>
          </div>
        </header>

        {/* ---- scene body (all mounted, active one visible) ---- */}
        <main className="relative flex min-h-0 flex-1 flex-col">
          {enabled.map((s, i) => {
            const Scene = s.Component;
            return (
              <div
                key={s.id}
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  i === displayIndex ? "" : "hidden"
                )}
              >
                <Scene />
              </div>
            );
          })}
        </main>

        {/* alert probes for off-screen scenes */}
        {monitored.map((s) => (
          <AlertMonitor key={s.id} scene={s} onReport={report} />
        ))}

        <style>{`
          .wallboard-noscrollbar { scrollbar-width: none; }
          .wallboard-noscrollbar::-webkit-scrollbar { display: none; }
          .kiosk-pulse { animation: kiosk-pulse 1.4s ease-in-out infinite; }
          @keyframes kiosk-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
          @media (prefers-reduced-motion: reduce) {
            .kiosk-pulse { animation: none; }
          }
        `}</style>
      </div>
    </KioskProvider>
  );
}

/**
 * Subtle two-tone notification ding via the Web Audio API — no audio asset
 * needed. Browsers block audio until a user gesture, so `unlockOnGesture`
 * installs a one-time listener that resumes the context on first click/tap;
 * `isUnlocked` lets the UI show a "click to enable sound" hint until then.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function isUnlocked(): boolean {
  return getContext()?.state === "running";
}

export function unlockOnGesture(onUnlocked?: () => void): () => void {
  const handler = () => {
    const c = getContext();
    if (c && c.state === "suspended") {
      c.resume().then(() => onUnlocked?.());
    } else {
      onUnlocked?.();
    }
  };
  window.addEventListener("pointerdown", handler, { once: true });
  return () => window.removeEventListener("pointerdown", handler);
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  peak: number
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playDing() {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  // Gentle E6 → G6 chime, quiet enough for an office
  tone(c, 1318.5, t, 0.35, 0.06);
  tone(c, 1568.0, t + 0.09, 0.45, 0.05);
}

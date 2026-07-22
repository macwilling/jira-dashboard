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

/**
 * Meeting alarm — a soft descending triple chime, more insistent than the
 * feed ding but still office-friendly. Fired once when a meeting hits the
 * 1-minute mark.
 */
export function playAlarm() {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  // A5 → A5 → E5, three quick pulses so it reads as "attention" not "new item"
  tone(c, 880.0, t, 0.3, 0.08);
  tone(c, 880.0, t + 0.22, 0.3, 0.08);
  tone(c, 659.3, t + 0.44, 0.5, 0.09);
}

/**
 * "Starting now" chime — a bright rising C6→E6→G6 arpeggio with a held top
 * note. Deliberately distinct from the descending 1-minute alarm (this one
 * goes *up*, reading as "go / it's time") and noticeable, but kept quiet.
 */
export function playStartNow() {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  tone(c, 1046.5, t, 0.26, 0.05);
  tone(c, 1318.5, t + 0.13, 0.26, 0.055);
  tone(c, 1568.0, t + 0.26, 0.6, 0.065);
}

/** A frequency-swept tone (for whooshes / launches). */
function sweep(
  c: AudioContext,
  fromFreq: number,
  toFreq: number,
  start: number,
  duration: number,
  peak: number,
  type: OscillatorType = "triangle"
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, start);
  osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// ─── Deploy "rocket launch" sequence (see DeployCountdown) ──────────────────

/** Dramatic two-tone klaxon that kicks off the deploy countdown. */
export function playDeployAlert() {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  tone(c, 440.0, t, 0.16, 0.09);
  tone(c, 587.33, t + 0.19, 0.16, 0.09);
  tone(c, 440.0, t + 0.38, 0.16, 0.09);
  tone(c, 587.33, t + 0.57, 0.24, 0.09);
}

/** One countdown blip; pitch rises as `remaining` drops for mounting tension. */
export function playCountdownBeep(remaining: number) {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  const freq = 620 + (5 - Math.min(5, Math.max(0, remaining))) * 105;
  tone(c, freq, t, 0.13, 0.085);
}

/** The blastoff — a rising whoosh capped with a bright pop. */
export function playLaunch() {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  sweep(c, 260, 1650, t, 0.5, 0.1);
  tone(c, 1568.0, t + 0.5, 0.45, 0.09);
  tone(c, 2093.0, t + 0.62, 0.5, 0.06);
}

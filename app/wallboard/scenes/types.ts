import type { ComponentType } from "react";

/**
 * An urgency signal a scene can raise so the kiosk can cut to it. Only
 * `critical` triggers a rotation cut-in; `warn` just surfaces in the ribbon.
 */
export interface SceneAlert {
  level: "critical" | "warn";
  /** Short reason shown in the shell ribbon, e.g. "IST-5600 blocked 2d 4h". */
  label: string;
}

/**
 * The kiosk scene contract. Every wallboard view registers one of these; the
 * shell rotates through them and (for scenes that expose `useAlert`) watches
 * their urgency even while they're off screen.
 */
export interface Scene {
  /** Stable id, also usable as a `?scene=` deep link. */
  id: string;
  /** Short label for the rotation rail and header. */
  title: string;
  /** Longer subtitle / data source, e.g. "Jira · sprint flow". */
  source: string;
  /** Accent hex for this scene's dot and progress bar. */
  accent: string;
  Component: ComponentType;
  /**
   * Optional urgency probe. The shell mounts this for EVERY registered scene
   * (inside the ticket provider) so a cut-in can fire even while the scene
   * isn't showing. Must obey the rules of hooks — called unconditionally on
   * every render for scenes that define it. Return `null` when calm.
   */
  useAlert?: () => SceneAlert | null;
  /** Per-scene dwell time in ms (falls back to the shell default). */
  dwellMs?: number;
  /** Set false to keep a scene registered but out of the rotation. */
  enabled?: boolean;
}

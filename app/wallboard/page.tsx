import KioskShell from "./kiosk/KioskShell";

/**
 * /wallboard — full-screen TV kiosk. The shell rotates through registered
 * scenes (see scenes/registry.ts); this route just mounts it.
 *
 * Deep links: `?scene=<id>` opens (and pins) one scene; `?kiosk=off` shows the
 * first scene without rotating.
 */
export default function WallboardPage() {
  return <KioskShell />;
}

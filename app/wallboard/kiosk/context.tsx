"use client";

import { createContext, useContext } from "react";

/**
 * Cross-scene chrome state owned by the KioskShell. Scenes read this instead
 * of managing their own copy — e.g. the Sprint Board's change toasts respect
 * the shell's single sound toggle rather than a per-scene one.
 */
export interface KioskContextValue {
  /** Whether notification sounds are enabled (shell owns the toggle). */
  soundOn: boolean;
  /** True once the browser has unlocked audio via a user gesture. */
  soundUnlocked: boolean;
}

const KioskContext = createContext<KioskContextValue>({
  soundOn: true,
  soundUnlocked: false,
});

export const KioskProvider = KioskContext.Provider;

export function useKiosk(): KioskContextValue {
  return useContext(KioskContext);
}

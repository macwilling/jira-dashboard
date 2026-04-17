import type { ReleaseType } from "./types";

export interface ParsedReleaseName {
  platform: string | null;
  releaseType: ReleaseType | null;
}

/**
 * Parses a Jira version name into platform prefix and release type.
 *
 * Expected format: platform@major.minor.patch  (e.g. web@1.1.0, android@2.0.0)
 * Falls back gracefully: bare semver (1.2.3) → platform = null; unparseable → both null.
 */
export function parseReleaseName(name: string): ParsedReleaseName {
  let platform: string | null = null;
  let semver: string = name;

  if (name.includes("@")) {
    const atIdx = name.indexOf("@");
    platform = name.slice(0, atIdx).trim() || null;
    semver = name.slice(atIdx + 1).trim();
  }

  const match = semver.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { platform, releaseType: null };
  }

  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);

  let releaseType: ReleaseType;
  if (minor === 0 && patch === 0) {
    releaseType = "major";
  } else if (patch === 0) {
    releaseType = "minor";
  } else {
    releaseType = "patch";
  }

  return { platform, releaseType };
}

/**
 * Adds `dayOffset` calendar days to a date string.
 * Accepts YYYY-MM-DD or full ISO timestamps — only the date part is used.
 * Returns a YYYY-MM-DD string.
 */
export function addDays(isoDate: string, dayOffset: number): string {
  const datePart = isoDate.slice(0, 10);
  const d = new Date(datePart + "T00:00:00Z");
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid release date: "${isoDate}"`);
  }
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

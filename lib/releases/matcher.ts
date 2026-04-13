import type { ReleaseTemplate, ReleaseType } from "./types";

interface ParsedReleaseName {
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
 * Finds the highest-priority matching template for a release name.
 * Templates must be sorted by priority ASC before calling.
 * Returns the first template where platform_prefix and release_type both match
 * (NULL fields in the template act as wildcards).
 */
export function matchTemplate(
  releaseName: string,
  templates: ReleaseTemplate[]
): ReleaseTemplate | null {
  const { platform, releaseType } = parseReleaseName(releaseName);

  for (const tmpl of templates) {
    const platformMatch =
      tmpl.platformPrefix === null ||
      tmpl.platformPrefix === platform;

    const typeMatch =
      tmpl.releaseType === null ||
      tmpl.releaseType === releaseType;

    if (platformMatch && typeMatch) {
      return tmpl;
    }
  }

  return null;
}

/**
 * Adds `dayOffset` calendar days to a date string.
 * Accepts YYYY-MM-DD or full ISO timestamps — only the date part is used.
 * Returns a YYYY-MM-DD string.
 */
export function addDays(isoDate: string, dayOffset: number): string {
  const datePart = isoDate.slice(0, 10); // handles both "2025-04-20" and "2025-04-20T00:00:00Z"
  const d = new Date(datePart + "T00:00:00Z");
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid release date: "${isoDate}"`);
  }
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

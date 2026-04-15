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
 * Returns ALL templates that match a release name, ordered by `priority` ASC
 * (same ordering as the input). Templates layer: every matching template
 * contributes its tasks to the release.
 *
 * Match rule per template: OR within each list, AND across the two.
 * `null` or empty list = wildcard. So a template with
 *   platformPrefixes: ["web", "android"], releaseTypes: ["minor"]
 * matches web or android minor releases only.
 *
 * A release with no matches produces no tasks — that's intentional. The release
 * manager should see "unmatched" as a signal the version name is wrong in Jira.
 */
export function matchTemplates(
  releaseName: string,
  templates: ReleaseTemplate[],
): ReleaseTemplate[] {
  const { platform, releaseType } = parseReleaseName(releaseName);

  return templates.filter((tmpl) => {
    const platformMatch =
      !tmpl.platformPrefixes ||
      tmpl.platformPrefixes.length === 0 ||
      (platform !== null && tmpl.platformPrefixes.includes(platform));

    const typeMatch =
      !tmpl.releaseTypes ||
      tmpl.releaseTypes.length === 0 ||
      (releaseType !== null && tmpl.releaseTypes.includes(releaseType));

    return platformMatch && typeMatch;
  });
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

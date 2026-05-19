"use client";

import { PRRecord } from "@/lib/github/types";

const REPO_CONFIG = [
  { key: "istrada-web",   label: "web",   color: "rgb(96,165,250)" },    // blue-400
  { key: "istrada-api",   label: "api",   color: "rgb(52,211,153)" },    // emerald-400
  { key: "istrada-droid", label: "droid", color: "rgb(251,191,36)" },    // amber-400
] as const;

interface Props {
  prs: PRRecord[];
  contributors: string[];
}

export function ByContributorView({ prs, contributors }: Props) {
  const byContributor = new Map<string, Map<string, number>>();
  for (const pr of prs) {
    if (!byContributor.has(pr.authorName)) byContributor.set(pr.authorName, new Map());
    const byRepo = byContributor.get(pr.authorName)!;
    byRepo.set(pr.repo, (byRepo.get(pr.repo) ?? 0) + 1);
  }

  const rows = contributors.map((name) => {
    const byRepo = byContributor.get(name) ?? new Map<string, number>();
    const total = [...byRepo.values()].reduce((s, n) => s + n, 0);
    return { name, byRepo, total };
  });

  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          paddingBottom: 16,
          paddingLeft: 56,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 8,
        }}
      >
        {REPO_CONFIG.map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: color,
                opacity: 0.8,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.35)",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {rows.map(({ name, byRepo, total }, i) => (
          <div
            key={name}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}
          >
            {/* Rank */}
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.2)",
                width: 20,
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>

            {/* Name */}
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "rgba(255,255,255,0.8)",
                width: 120,
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>

            {/* Bar track */}
            <div
              style={{
                flex: 1,
                height: 20,
                borderRadius: 3,
                background: "rgba(255,255,255,0.05)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Filled portion, proportional to max */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  height: "100%",
                  width: `${(total / maxTotal) * 100}%`,
                  display: "flex",
                  borderRadius: 3,
                  overflow: "hidden",
                  transition: "width 0.3s ease",
                }}
              >
                {REPO_CONFIG.map(({ key, color }) => {
                  const count = byRepo.get(key) ?? 0;
                  if (count === 0 || total === 0) return null;
                  return (
                    <div
                      key={key}
                      title={`${key.replace("istrada-", "")}: ${count}`}
                      style={{
                        width: `${(count / total) * 100}%`,
                        background: color,
                        opacity: 0.75,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Total */}
            <span
              style={{
                fontSize: 14,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: "rgba(255,255,255,0.6)",
                width: 28,
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

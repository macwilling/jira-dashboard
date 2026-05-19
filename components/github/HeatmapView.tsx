"use client";

import { useState } from "react";
import { PRRecord } from "@/lib/github/types";

interface Props {
  prs: PRRecord[];
  contributors: string[];
  dateRange: { from: string; to: string };
}

function getDatesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 5-step scale: transparent → dark red → vivid red
const COLOR_STEPS = [
  { bg: "rgba(255,255,255,0.06)", text: "transparent" },       // 0
  { bg: "rgb(69,10,10)",          text: "rgb(248,113,113)" },  // 1 – red-950
  { bg: "rgb(127,29,29)",         text: "rgb(252,165,165)" },  // 2 – red-900
  { bg: "rgb(185,28,28)",         text: "rgb(255,255,255)" },  // 3 – red-700
  { bg: "rgb(220,38,38)",         text: "rgb(255,255,255)" },  // 4 – red-600
  { bg: "rgb(239,68,68)",         text: "rgb(255,255,255)" },  // 5+ – red-500
];

function cellStyle(count: number) {
  const step = COLOR_STEPS[Math.min(count, COLOR_STEPS.length - 1)];
  return { background: step.bg, color: step.text };
}

const CELL = 26;
const GAP = 2;
const NAME_W = 130;

export function HeatmapView({ prs, contributors, dateRange }: Props) {
  const [hovered, setHovered] = useState<string | null>(null); // "name|date"

  const dates = getDatesInRange(dateRange.from, dateRange.to);

  const matrix = new Map<string, Map<string, number>>();
  for (const pr of prs) {
    const d = pr.mergedAt.slice(0, 10);
    if (!matrix.has(pr.authorName)) matrix.set(pr.authorName, new Map());
    const row = matrix.get(pr.authorName)!;
    row.set(d, (row.get(d) ?? 0) + 1);
  }

  const totals = new Map<string, number>(
    contributors.map((name) => {
      const row = matrix.get(name);
      const t = row ? [...row.values()].reduce((s, n) => s + n, 0) : 0;
      return [name, t];
    })
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div style={{ display: "inline-flex", flexDirection: "column", gap: GAP }}>

        {/* Date header */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: GAP, paddingLeft: NAME_W + 8 }}>
          {dates.map((d) => (
            <div
              key={d}
              style={{ width: CELL, height: 44, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
            >
              <span
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.25)",
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  lineHeight: 1,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {fmtDate(d)}
              </span>
            </div>
          ))}
          <div style={{ width: 36, paddingBottom: 2, paddingLeft: 6 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>
              tot
            </span>
          </div>
        </div>

        {/* Rows */}
        {contributors.map((name) => {
          const row = matrix.get(name);
          const total = totals.get(name) ?? 0;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center" }}>
              {/* Name */}
              <div
                style={{
                  width: NAME_W,
                  paddingRight: 8,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.75)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </span>
              </div>

              {/* Cells */}
              <div style={{ display: "flex", gap: GAP }}>
                {dates.map((d) => {
                  const count = row?.get(d) ?? 0;
                  const key = `${name}|${d}`;
                  const isHov = hovered === key;
                  return (
                    <div
                      key={d}
                      title={count > 0 ? `${count} PR${count !== 1 ? "s" : ""} — ${fmtDate(d)}` : undefined}
                      onMouseEnter={() => count > 0 && setHovered(key)}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        cursor: count > 0 ? "default" : undefined,
                        transition: "filter 0.08s",
                        filter: isHov ? "brightness(1.35)" : undefined,
                        flexShrink: 0,
                        ...cellStyle(count),
                      }}
                    >
                      {count > 0 ? count : null}
                    </div>
                  );
                })}

                {/* Row total */}
                <div
                  style={{
                    width: 36,
                    height: CELL,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 6,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                      color: "rgba(255,255,255,0.35)",
                    }}
                  >
                    {total}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 20,
          paddingLeft: NAME_W + 8,
        }}
      >
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>
          less
        </span>
        {COLOR_STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              flexShrink: 0,
              ...cellStyle(i),
            }}
          />
        ))}
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>
          more
        </span>
      </div>
    </div>
  );
}

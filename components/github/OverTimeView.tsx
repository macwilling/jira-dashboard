"use client";

import { useState } from "react";
import { PRRecord } from "@/lib/github/types";

interface Props {
  prs: PRRecord[];
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

const CHART_H = 180;

export function OverTimeView({ prs, dateRange }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dates = getDatesInRange(dateRange.from, dateRange.to);

  const countByDate = new Map<string, number>();
  for (const pr of prs) {
    const d = pr.mergedAt.slice(0, 10);
    countByDate.set(d, (countByDate.get(d) ?? 0) + 1);
  }

  const counts = dates.map((d) => countByDate.get(d) ?? 0);
  const maxCount = Math.max(...counts, 1);

  const BAR_W = dates.length > 60 ? 8 : dates.length > 30 ? 12 : 18;
  const BAR_GAP = 2;
  const labelEvery = dates.length <= 14 ? 1 : dates.length <= 31 ? 3 : 7;

  const gridValues = [maxCount, Math.round(maxCount / 2)];

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 12 }}>

        {/* Y-axis labels */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: CHART_H,
            paddingBottom: 1,
            alignItems: "flex-end",
          }}
        >
          {gridValues.map((v) => (
            <span
              key={v}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.2)",
                lineHeight: 1,
              }}
            >
              {v}
            </span>
          ))}
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "rgba(255,255,255,0.2)",
              lineHeight: 1,
            }}
          >
            0
          </span>
        </div>

        {/* Chart + x-axis */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>

            {/* Bar chart */}
            <div
              style={{
                position: "relative",
                height: CHART_H,
                display: "inline-flex",
                alignItems: "flex-end",
                gap: BAR_GAP,
              }}
            >
              {/* Gridlines */}
              {gridValues.map((v, gi) => (
                <div
                  key={v}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: `${(v / maxCount) * 100}%`,
                    borderTop: `1px solid rgba(255,255,255,${gi === 0 ? 0.06 : 0.04})`,
                    pointerEvents: "none",
                  }}
                />
              ))}

              {/* Bars */}
              {dates.map((d, i) => {
                const count = counts[i];
                const barH = count === 0
                  ? 2
                  : Math.max(4, Math.round((count / maxCount) * CHART_H));
                const isHov = hoveredIdx === i;
                const intensity = count / maxCount;

                return (
                  <div
                    key={d}
                    style={{
                      position: "relative",
                      width: BAR_W,
                      height: CHART_H,
                      display: "flex",
                      alignItems: "flex-end",
                      flexShrink: 0,
                      cursor: count > 0 ? "default" : undefined,
                    }}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* Tooltip */}
                    {isHov && count > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: barH + 6,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          padding: "5px 8px",
                          zIndex: 20,
                          pointerEvents: "none",
                          whiteSpace: "nowrap",
                          textAlign: "center",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-mono)",
                            color: "rgba(255,255,255,0.4)",
                            marginBottom: 2,
                          }}
                        >
                          {fmtDate(d)}
                        </div>
                        <div
                          style={{
                            fontSize: 15,
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            color: "rgba(255,255,255,0.9)",
                          }}
                        >
                          {count}
                        </div>
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      style={{
                        width: "100%",
                        height: barH,
                        borderRadius: "2px 2px 0 0",
                        background: count === 0
                          ? "rgba(255,255,255,0.05)"
                          : isHov
                          ? "rgb(248,113,113)"
                          : `rgba(220,38,38,${0.25 + intensity * 0.75})`,
                        transition: "background 0.1s",
                        flexShrink: 0,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Baseline */}
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.12)",
                marginBottom: 4,
              }}
            />

            {/* X-axis labels */}
            <div
              style={{
                display: "inline-flex",
                gap: BAR_GAP,
                paddingTop: 2,
              }}
            >
              {dates.map((d, i) => (
                <div
                  key={d}
                  style={{
                    width: BAR_W,
                    flexShrink: 0,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  {i % labelEvery === 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                        color: "rgba(255,255,255,0.2)",
                        writingMode: dates.length > 20 ? "vertical-rl" : undefined,
                        transform: dates.length > 20 ? "rotate(180deg)" : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtDate(d)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

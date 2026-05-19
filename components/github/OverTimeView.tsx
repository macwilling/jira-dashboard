"use client";

import { PRRecord } from "@/lib/github/types";
import { useState } from "react";

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

function formatLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function OverTimeView({ prs, dateRange }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const dates = getDatesInRange(dateRange.from, dateRange.to);

  // Count PRs per day
  const countByDate = new Map<string, number>();
  for (const pr of prs) {
    const d = pr.mergedAt.slice(0, 10);
    countByDate.set(d, (countByDate.get(d) ?? 0) + 1);
  }

  const counts = dates.map((d) => countByDate.get(d) ?? 0);
  const maxCount = Math.max(...counts, 1);

  // Show label every N days to avoid crowding
  const labelEvery = dates.length <= 14 ? 1 : dates.length <= 30 ? 3 : 7;

  const BAR_HEIGHT = 160;

  return (
    <div className="w-full">
      <div className="flex items-end gap-[3px] overflow-x-auto pb-1" style={{ height: BAR_HEIGHT + 32 }}>
        {dates.map((d, i) => {
          const count = counts[i];
          const barH = count === 0 ? 2 : Math.max(8, Math.round((count / maxCount) * BAR_HEIGHT));
          const isHovered = hoveredDate === d;
          return (
            <div
              key={d}
              className="flex flex-col items-center flex-shrink-0"
              style={{ width: dates.length > 60 ? 10 : dates.length > 30 ? 14 : 20 }}
              onMouseEnter={() => setHoveredDate(d)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {/* tooltip */}
              <div
                className="relative"
                style={{ height: BAR_HEIGHT, display: "flex", alignItems: "flex-end" }}
              >
                {isHovered && count > 0 && (
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-popover border rounded px-2 py-1 text-xs text-foreground whitespace-nowrap z-10 shadow">
                    {formatLabel(d)}: {count} PR{count !== 1 ? "s" : ""}
                  </div>
                )}
                <div
                  className={`w-full rounded-t transition-colors ${
                    count === 0
                      ? "bg-muted/30"
                      : isHovered
                      ? "bg-red-500"
                      : "bg-red-700"
                  }`}
                  style={{ height: barH }}
                />
              </div>
              {i % labelEvery === 0 && (
                <div
                  className="text-[9px] text-muted-foreground/60 mt-1 whitespace-nowrap"
                  style={{
                    writingMode: dates.length > 30 ? "vertical-rl" : undefined,
                    transform: dates.length > 30 ? "rotate(180deg)" : undefined,
                  }}
                >
                  {formatLabel(d)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

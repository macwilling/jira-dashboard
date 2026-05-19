"use client";

import { PRRecord } from "@/lib/github/types";
import { cn } from "@/lib/utils";

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

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function cellColor(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "bg-red-950 text-red-400";
  if (count === 2) return "bg-red-900 text-red-200";
  if (count <= 4) return "bg-red-700 text-white";
  return "bg-red-500 text-white";
}

export function HeatmapView({ prs, contributors, dateRange }: Props) {
  const dates = getDatesInRange(dateRange.from, dateRange.to);

  // Build matrix: authorName → dateStr → count
  const matrix = new Map<string, Map<string, number>>();
  for (const pr of prs) {
    const dateStr = pr.mergedAt.slice(0, 10);
    if (!matrix.has(pr.authorName)) matrix.set(pr.authorName, new Map());
    const byDate = matrix.get(pr.authorName)!;
    byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + 1);
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px]">
        <thead>
          <tr>
            {/* name column header */}
            <th className="w-32 min-w-32" />
            {dates.map((d) => (
              <th key={d} className="w-7 min-w-7 p-0 align-bottom">
                <div
                  className="text-[10px] text-muted-foreground/60 whitespace-nowrap"
                  style={{
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                    height: 48,
                    lineHeight: 1,
                  }}
                >
                  {formatDateLabel(d)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contributors.map((name) => {
            const byDate = matrix.get(name);
            return (
              <tr key={name}>
                <td className="pr-3 text-sm font-medium text-foreground whitespace-nowrap">
                  {name}
                </td>
                {dates.map((d) => {
                  const count = byDate?.get(d) ?? 0;
                  return (
                    <td key={d} className="p-0">
                      {count > 0 ? (
                        <div
                          title={`${count} PR${count > 1 ? "s" : ""} on ${formatDateLabel(d)}`}
                          className={cn(
                            "w-7 h-7 rounded flex items-center justify-center text-[11px] font-semibold tabular-nums cursor-default",
                            cellColor(count),
                            count === 1 && "opacity-70"
                          )}
                        >
                          {count}
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded bg-muted/20" />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-muted-foreground/50">
        darker = more PRs
      </p>
    </div>
  );
}

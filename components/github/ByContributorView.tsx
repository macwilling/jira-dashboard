"use client";

import { PRRecord } from "@/lib/github/types";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];

interface Props {
  prs: PRRecord[];
  contributors: string[];
}

export function ByContributorView({ prs, contributors }: Props) {
  // Build per-contributor totals
  const byContributor = new Map<string, Map<string, number>>();
  for (const pr of prs) {
    if (!byContributor.has(pr.authorName))
      byContributor.set(pr.authorName, new Map());
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
    <div className="w-full max-w-3xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="text-left pb-2 pr-4 font-medium w-40">Contributor</th>
            {REPOS.map((r) => (
              <th key={r} className="text-right pb-2 px-3 font-medium whitespace-nowrap">
                {r.replace("istrada-", "")}
              </th>
            ))}
            <th className="text-right pb-2 pl-3 font-medium">Total</th>
            <th className="pb-2 pl-4 w-48" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, byRepo, total }) => (
            <tr key={name} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
              <td className="py-2 pr-4 font-medium text-foreground">{name}</td>
              {REPOS.map((repo) => (
                <td key={repo} className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                  {byRepo.get(repo) ?? 0}
                </td>
              ))}
              <td className="py-2 pl-3 text-right tabular-nums font-semibold text-foreground">
                {total}
              </td>
              <td className="py-2 pl-4">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-700 rounded-full transition-all"
                    style={{ width: `${(total / maxTotal) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Tags,
  ArrowRight,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReleaseCategory } from "@/lib/releases/types";

interface CategoryWithWorkflow extends ReleaseCategory {
  workflow: { id: string; name: string } | null;
}

interface WorkflowOption {
  id: string;
  name: string;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryWithWorkflow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/releases/categories")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories ?? []);
        setWorkflows(d.workflows ?? []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const assign = async (categoryId: string, workflowId: string | null) => {
    setSavingId(categoryId);
    setSavedId(null);
    try {
      const res = await fetch("/api/releases/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, workflowId }),
      });
      if (res.ok) {
        // Optimistic update.
        const workflow =
          workflowId === null
            ? null
            : workflows.find((w) => w.id === workflowId) ?? null;
        setCategories((prev) =>
          prev.map((c) =>
            c.id === categoryId
              ? { ...c, workflowId, workflow }
              : c,
          ),
        );
        setSavedId(categoryId);
        setTimeout(() => {
          setSavedId((s) => (s === categoryId ? null : s));
        }, 1500);
      }
    } finally {
      setSavingId(null);
    }
  };

  return (
    <AppShell title="Release Categories">
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <p className="text-xs text-muted-foreground">
          Release names are matched against these 6 (platform, release-type)
          slots. Each slot maps to exactly one workflow — or none, in which
          case matching releases sit in the unmatched state. Create and edit
          workflows on the{" "}
          <Link
            href="/releases/workflows"
            className="underline hover:text-foreground"
          >
            workflows page
          </Link>
          .
        </p>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && categories.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <Tags className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No categories.</p>
            <p className="text-xs mt-1">
              Expected 6 seeded categories — did the 0012 migration run?
            </p>
          </div>
        )}

        {!loading && categories.length > 0 && (
          <div className="rounded-lg border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr className="text-left">
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Category
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground w-10" />
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workflow
                  </th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 px-1.5 font-mono"
                        >
                          {c.key}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          matches <code className="bg-muted px-1 rounded">
                            {c.platformPrefix}@*
                          </code>{" "}
                          · {c.releaseType}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground/50">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <WorkflowIcon
                          className={cn(
                            "h-3.5 w-3.5",
                            c.workflow
                              ? "text-muted-foreground"
                              : "text-muted-foreground/40",
                          )}
                        />
                        <select
                          value={c.workflowId ?? ""}
                          onChange={(e) =>
                            assign(c.id, e.target.value || null)
                          }
                          disabled={savingId === c.id}
                          className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-w-[240px]"
                        >
                          <option value="">— unassigned —</option>
                          {workflows.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        {c.workflow && (
                          <Link
                            href={`/releases/workflows/${c.workflow.id}`}
                            className="text-xxs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            Edit
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {savingId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                      ) : savedId === c.id ? (
                        <span className="text-xxs text-green-600 dark:text-green-500">
                          Saved
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}

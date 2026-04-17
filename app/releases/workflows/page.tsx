"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  Workflow as WorkflowIcon,
  Bell,
  CheckSquare,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Workflow } from "@/lib/releases/types";

interface WorkflowListItem extends Workflow {
  taskCount: number;
  notificationCount: number;
  categories: { id: string; key: string }[];
}

export default function WorkflowsListPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/releases/workflows")
      .then((r) => r.json())
      .then((d) => setWorkflows(d.workflows ?? []))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    const res = await fetch("/api/releases/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Untitled workflow" }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok && data.workflow?.id) {
      router.push(`/releases/workflows/${data.workflow.id}`);
    }
  };

  const actions = (
    <div className="ml-auto flex items-center gap-2">
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={handleCreate}
        disabled={creating}
      >
        {creating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        New workflow
      </Button>
    </div>
  );

  return (
    <AppShell title="Workflows" actions={actions}>
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <p className="text-xs text-muted-foreground">
          A workflow defines what happens when a release with its category ships:
          the ordered task list, the approval Slack target, and the notification
          rules. Assign workflows to categories on the{" "}
          <Link href="/releases/categories" className="underline hover:text-foreground">
            categories page
          </Link>
          .
        </p>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && workflows.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <WorkflowIcon className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No workflows yet.</p>
            <p className="text-xs mt-1">
              Create one and assign it to a category to start firing tasks.
            </p>
          </div>
        )}

        {!loading && workflows.length > 0 && (
          <div className="rounded-lg border overflow-hidden bg-card">
            {workflows.map((w) => (
              <Link
                key={w.id}
                href={`/releases/workflows/${w.id}`}
                className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
              >
                <WorkflowIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="inline-flex items-center gap-1">
                      <CheckSquare className="h-3 w-3" />
                      {w.taskCount} task{w.taskCount === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Bell className="h-3 w-3" />
                      {w.notificationCount} notification
                      {w.notificationCount === 1 ? "" : "s"}
                    </span>
                    {w.approvalSlackTarget && (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <ShieldCheck className="h-3 w-3" />
                        Approval gated
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {w.categories.length === 0 ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 text-muted-foreground"
                    >
                      Unassigned
                    </Badge>
                  ) : (
                    w.categories.map((c) => (
                      <Badge
                        key={c.id}
                        variant="secondary"
                        className="text-[10px] h-5 px-1.5 font-mono"
                      >
                        {c.key}
                      </Badge>
                    ))
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

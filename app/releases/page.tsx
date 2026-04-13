"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Release } from "@/lib/releases/types";

interface ReleaseWithMeta extends Release {
  matchedTemplate: { id: string; name: string } | null;
  taskProgress: { total: number; done: number };
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<ReleaseWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/releases")
      .then((r) => r.json())
      .then((data) => setReleases(data.releases ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between h-11 px-4">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <h1 className="text-sm font-semibold tracking-tight">Releases</h1>
          </div>
          <Link href="/releases/templates">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Package className="h-3.5 w-3.5" />
              Manage Templates
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive text-center py-8">{error}</p>
        )}

        {!loading && !error && releases.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No releases yet.</p>
            <p className="text-xs mt-1">
              Releases appear here when Jira version webhooks are received.
            </p>
          </div>
        )}

        {!loading && releases.length > 0 && (
          <div className="rounded-lg border divide-y">
            {releases.map((release) => (
              <Link
                key={release.id}
                href={`/releases/${release.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-foreground">
                      {release.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {release.releaseDate ?? "No date set"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {release.released && (
                    <Badge variant="secondary" className="text-xs h-5">
                      Released
                    </Badge>
                  )}
                  {release.archived && (
                    <Badge variant="outline" className="text-xs h-5">
                      Archived
                    </Badge>
                  )}
                  {release.matchedTemplate ? (
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {release.matchedTemplate.name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50 hidden sm:inline">
                      No template
                    </span>
                  )}
                  {release.taskProgress.total > 0 ? (
                    <ProgressBar
                      done={release.taskProgress.done}
                      total={release.taskProgress.total}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground/50 tabular-nums w-20 text-right">
                      —
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

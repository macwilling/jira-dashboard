"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Library, Lock, Unlock } from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GoogleTasksIcon,
  GoogleCalendarIcon,
} from "@/components/releases/GoogleIcons";
import type {
  ActionType,
  ConfigurableField,
  TaskDefinition,
} from "@/lib/releases/types";

const ALL_FIELDS: ConfigurableField[] = [
  "label",
  "description",
  "dayOffset",
  "allDay",
  "startTime",
  "durationMinutes",
  "actionConfig",
];

function ActionIcon({ actionType }: { actionType: ActionType }) {
  if (actionType === "calendar_event")
    return <GoogleCalendarIcon className="h-4 w-4" />;
  if (actionType === "google_task")
    return <GoogleTasksIcon className="h-4 w-4 rounded" />;
  return null;
}

export default function TaskLibraryPage() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/releases/task-definitions")
      .then((r) => r.json())
      .then((d) => setDefinitions(d.definitions ?? []))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    const res = await fetch("/api/releases/task-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New task definition",
        label: "Task title",
        actionType: "google_task",
        configurableFields: [],
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok && data.definition?.id) {
      router.push(`/releases/task-library/${data.definition.id}`);
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
        New definition
      </Button>
    </div>
  );

  return (
    <AppShell title="Task Library" actions={actions}>
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <p className="text-xs text-muted-foreground">
          Reusable action definitions that templates can reference. Each field is
          either <Lock className="inline h-3 w-3 mx-0.5 align-text-bottom" /> locked
          (same value everywhere this definition is used) or{" "}
          <Unlock className="inline h-3 w-3 mx-0.5 align-text-bottom" /> configurable
          (use-sites can override). Change a definition here and every future release
          picks up the change — past releases are unaffected.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && definitions.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <Library className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No task definitions yet.</p>
            <p className="text-xs mt-1">
              Create one to share an action (e.g. &ldquo;Deploy calendar event&rdquo;)
              across multiple templates.
            </p>
          </div>
        )}

        {!loading && definitions.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            {definitions.map((def) => {
              const configurable = new Set(def.configurableFields);
              return (
                <Link
                  key={def.id}
                  href={`/releases/task-library/${def.id}`}
                  className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 bg-background hover:bg-muted/50 transition-colors"
                >
                  <ActionIcon actionType={def.actionType} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{def.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {def.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {ALL_FIELDS.map((f) => {
                      const isOn = configurable.has(f);
                      return (
                        <Badge
                          key={f}
                          variant={isOn ? "secondary" : "outline"}
                          className={
                            "text-[10px] h-4 px-1.5 gap-0.5 font-mono " +
                            (isOn ? "" : "text-muted-foreground/60")
                          }
                        >
                          {isOn ? (
                            <Unlock className="h-2.5 w-2.5" />
                          ) : (
                            <Lock className="h-2.5 w-2.5" />
                          )}
                          {f}
                        </Badge>
                      );
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}

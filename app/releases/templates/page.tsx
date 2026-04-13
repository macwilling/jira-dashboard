"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  GripVertical,
  ListChecks,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReleaseTemplate } from "@/lib/releases/types";

function SortableTemplateRow({ template }: { template: ReleaseTemplate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 bg-background hover:bg-muted/50 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{template.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {template.platformPrefix ? (
            <Badge variant="secondary" className="text-xs h-4 px-1.5">
              {template.platformPrefix}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs h-4 px-1.5 text-muted-foreground">
              any platform
            </Badge>
          )}
          {template.releaseType ? (
            <Badge variant="secondary" className="text-xs h-4 px-1.5">
              {template.releaseType}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs h-4 px-1.5 text-muted-foreground">
              any type
            </Badge>
          )}
        </div>
      </div>

      <Link href={`/releases/templates/${template.id}`}>
        <Button variant="ghost" size="sm" className="h-7 text-xs">
          Edit
        </Button>
      </Link>
    </div>
  );
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<ReleaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetch("/api/releases/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .finally(() => setLoading(false));
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = templates.findIndex((t) => t.id === active.id);
    const newIndex = templates.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(templates, oldIndex, newIndex);
    setTemplates(reordered);

    setSaving(true);
    await fetch("/api/releases/templates/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((t) => t.id) }),
    }).finally(() => setSaving(false));
  };

  const handleCreate = async () => {
    setCreating(true);
    const res = await fetch("/api/releases/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Template" }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok && data.template?.id) {
      router.push(`/releases/templates/${data.template.id}`);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between h-11 px-4">
          <div className="flex items-center gap-2">
            <Link
              href="/releases"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <h1 className="text-sm font-semibold tracking-tight">
              Release Templates
            </h1>
            {saving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
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
            New Template
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <p className="text-xs text-muted-foreground">
          Templates are matched in priority order (top = highest). The first
          template whose platform and release type filters match the release name
          wins. A template with no filters is a catch-all fallback.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && templates.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <ListChecks className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No templates yet.</p>
            <p className="text-xs mt-1">
              Create a template to define the checklist for each release type.
            </p>
          </div>
        )}

        {!loading && templates.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={templates.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="rounded-lg border overflow-hidden">
                {templates.map((template) => (
                  <SortableTemplateRow key={template.id} template={template} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </div>
  );
}

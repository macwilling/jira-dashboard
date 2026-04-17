import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkflow,
  getWorkflow,
  listWorkflowNotifications,
  listWorkflowTasks,
  replaceWorkflowNotifications,
  replaceWorkflowTasks,
  updateWorkflow,
  type WorkflowNotificationInput,
  type WorkflowTaskInput,
} from "@/lib/releases/workflows-store";
import { listCategories } from "@/lib/releases/categories";
import type {
  ActionType,
  NotificationButton,
  ReleaseEventType,
  WorkflowTaskOverrides,
} from "@/lib/releases/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const workflow = await getWorkflow(id);
    if (!workflow) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const [tasks, notifications, categories] = await Promise.all([
      listWorkflowTasks(id),
      listWorkflowNotifications(id),
      listCategories(),
    ]);
    const assignedCategories = categories
      .filter((c) => c.workflowId === id)
      .map((c) => ({ id: c.id, key: c.key }));
    return NextResponse.json({
      workflow,
      tasks,
      notifications,
      categories: assignedCategories,
    });
  } catch (e) {
    console.error("[GET /api/releases/workflows/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

interface PutBody {
  name?: string;
  approvalSlackTarget?: string | null;
  tasks?: WorkflowTaskInputBody[];
  notifications?: WorkflowNotificationInputBody[];
}

interface WorkflowTaskInputBody {
  definitionId?: string | null;
  label?: string;
  description?: string | null;
  actionType?: ActionType;
  dayOffset?: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
  overrides?: WorkflowTaskOverrides | null;
}

interface WorkflowNotificationInputBody {
  eventType?: ReleaseEventType;
  message?: string;
  target?: string;
  buttons?: NotificationButton[];
}

function normalizeTask(t: WorkflowTaskInputBody): WorkflowTaskInput | null {
  if (!t.label?.trim() || !t.actionType) return null;
  return {
    definitionId: t.definitionId ?? null,
    label: t.label.trim(),
    description: t.description ?? null,
    actionType: t.actionType,
    dayOffset: t.dayOffset ?? 0,
    allDay: t.allDay,
    startTime: t.startTime ?? null,
    durationMinutes: t.durationMinutes ?? 30,
    actionConfig: t.actionConfig ?? null,
    overrides: t.overrides ?? null,
  };
}

function normalizeNotification(
  n: WorkflowNotificationInputBody,
): WorkflowNotificationInput | null {
  if (!n.eventType || !n.message?.trim() || !n.target?.trim()) return null;
  return {
    eventType: n.eventType,
    message: n.message,
    target: n.target.trim(),
    buttons: n.buttons,
  };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const existing = await getWorkflow(id);
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as PutBody;

    if (body.name !== undefined || body.approvalSlackTarget !== undefined) {
      await updateWorkflow(id, {
        name: body.name?.trim() || undefined,
        approvalSlackTarget:
          body.approvalSlackTarget === undefined
            ? undefined
            : body.approvalSlackTarget,
      });
    }

    if (Array.isArray(body.tasks)) {
      const tasks = body.tasks
        .map(normalizeTask)
        .filter((t): t is WorkflowTaskInput => t !== null);
      await replaceWorkflowTasks(id, tasks);
    }

    if (Array.isArray(body.notifications)) {
      const notifications = body.notifications
        .map(normalizeNotification)
        .filter((n): n is WorkflowNotificationInput => n !== null);
      await replaceWorkflowNotifications(id, notifications);
    }

    const [workflow, tasks, notifications] = await Promise.all([
      getWorkflow(id),
      listWorkflowTasks(id),
      listWorkflowNotifications(id),
    ]);
    return NextResponse.json({ workflow, tasks, notifications });
  } catch (e) {
    console.error("[PUT /api/releases/workflows/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const categories = await listCategories();
    const assigned = categories.filter((c) => c.workflowId === id);
    if (assigned.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: still assigned to ${assigned.length} category/categories (${assigned.map((c) => c.key).join(", ")}). Reassign them first.`,
        },
        { status: 409 },
      );
    }
    await deleteWorkflow(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/releases/workflows/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

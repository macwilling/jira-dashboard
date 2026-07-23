import { NextRequest, NextResponse } from "next/server";
import {
  getDayEvents,
  getTaskStatusMap,
  hasGoogleConfig,
} from "@/lib/google/client";

// Calendar events for the wallboard "My Day" screen. `dayStart` is the
// viewer's local midnight as an ISO stamp (the server can't know the TV's
// timezone); optional `days` (1–7, default 1) widens the window — the screen
// uses days=7 starting tomorrow for the next-workday pre-read. Degrades
// quietly — a missing/disconnected Google config returns an empty list rather
// than an error, matching /api/google/calendar/next.
export async function GET(req: NextRequest) {
  if (!hasGoogleConfig()) {
    return NextResponse.json({ events: [], connected: false });
  }
  const dayStart = req.nextUrl.searchParams.get("dayStart");
  if (!dayStart || Number.isNaN(new Date(dayStart).getTime())) {
    return NextResponse.json({ error: "invalid dayStart" }, { status: 400 });
  }
  const daysRaw = parseInt(req.nextUrl.searchParams.get("days") ?? "1", 10);
  const days = Math.min(7, Math.max(1, Number.isNaN(daysRaw) ? 1 : daysRaw));
  try {
    const events = await getDayEvents(dayStart, days);
    // Resolve completion for scheduled tasks on the single-day view (the My Day
    // agenda). Skipped for the multi-day pre-read — future tasks aren't "done"
    // yet — and best-effort: a missing Tasks scope just leaves taskCompleted null.
    if (days === 1 && events.some((e) => e.taskSlug)) {
      try {
        const statuses = await getTaskStatusMap();
        for (const e of events) {
          if (e.taskSlug && e.taskSlug in statuses) {
            e.taskCompleted = statuses[e.taskSlug];
          }
        }
      } catch {
        // leave taskCompleted null — the screen degrades to "open/scheduled".
      }
    }
    return NextResponse.json({ events, connected: true });
  } catch (e) {
    const msg = (e as Error).message;
    // "not connected" is expected before OAuth is set up — treat as no events.
    if (msg.includes("not connected")) {
      return NextResponse.json({ events: [], connected: false });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

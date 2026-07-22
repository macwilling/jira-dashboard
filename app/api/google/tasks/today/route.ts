import { NextRequest, NextResponse } from "next/server";
import { getTasksDueBy, hasGoogleConfig } from "@/lib/google/client";

// Tasks due today or overdue, for the wallboard "My Day" rail. `date` is the
// viewer's local day (YYYY-MM-DD — the server can't know the TV's timezone).
// Degrades quietly, matching the calendar routes.
export async function GET(req: NextRequest) {
  if (!hasGoogleConfig()) {
    return NextResponse.json({ tasks: [], connected: false });
  }
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  try {
    const tasks = await getTasksDueBy(date);
    return NextResponse.json({ tasks, connected: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not connected")) {
      return NextResponse.json({ tasks: [], connected: false });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

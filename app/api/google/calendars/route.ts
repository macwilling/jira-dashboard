import { NextResponse } from "next/server";
import { listCalendars } from "@/lib/google/client";

export async function GET() {
  try {
    const calendars = await listCalendars();
    return NextResponse.json({ calendars });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

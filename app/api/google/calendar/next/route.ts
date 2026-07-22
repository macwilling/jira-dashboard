import { NextResponse } from "next/server";
import { getNextMeeting, hasGoogleConfig } from "@/lib/google/client";

// Next upcoming meeting for the wallboard countdown. Degrades quietly — a
// missing/disconnected Google config returns { meeting: null } rather than an
// error, so the header just shows no countdown instead of a broken state.
export async function GET() {
  if (!hasGoogleConfig()) {
    return NextResponse.json({ meeting: null, connected: false });
  }
  try {
    const meeting = await getNextMeeting();
    return NextResponse.json({ meeting, connected: true });
  } catch (e) {
    const msg = (e as Error).message;
    // "not connected" is expected before OAuth is set up — treat as no meeting.
    if (msg.includes("not connected")) {
      return NextResponse.json({ meeting: null, connected: false });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

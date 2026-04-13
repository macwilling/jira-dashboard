import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  deleteGoogleCredentials,
  hasGoogleConfig,
} from "@/lib/google/client";

/** GET — redirect the browser to Google's OAuth consent screen. */
export async function GET(req: NextRequest) {
  if (!hasGoogleConfig()) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set" },
      { status: 503 }
    );
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/google/callback`;
  const authUrl = buildAuthUrl(redirectUri);

  return NextResponse.redirect(authUrl);
}

/** DELETE — disconnect Google account (removes stored credentials). */
export async function DELETE() {
  await deleteGoogleCredentials();
  return NextResponse.json({ ok: true });
}

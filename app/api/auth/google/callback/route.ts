import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  saveGoogleCredentials,
  emailFromIdToken,
} from "@/lib/google/client";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${origin}/settings?google_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?google_error=missing_code`
    );
  }

  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      // This can happen if the user had already authorized; we requested prompt=consent
      // so it should always return a refresh_token. If not, something went wrong.
      return NextResponse.redirect(
        `${origin}/settings?google_error=no_refresh_token`
      );
    }

    const email = tokens.id_token
      ? emailFromIdToken(tokens.id_token)
      : "unknown";

    await saveGoogleCredentials({
      refreshToken: tokens.refresh_token,
      email,
      connectedAt: new Date().toISOString(),
    });

    return NextResponse.redirect(`${origin}/settings?google_connected=1`);
  } catch (e) {
    console.error("[google callback]", e);
    return NextResponse.redirect(
      `${origin}/settings?google_error=${encodeURIComponent((e as Error).message)}`
    );
  }
}

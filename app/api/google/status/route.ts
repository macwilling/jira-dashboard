import { NextResponse } from "next/server";
import { getGoogleCredentials, hasGoogleConfig } from "@/lib/google/client";

export async function GET() {
  const configured = hasGoogleConfig();
  const credentials = configured ? await getGoogleCredentials() : null;

  return NextResponse.json({
    configured,
    connected: !!credentials,
    email: credentials?.email ?? null,
    connectedAt: credentials?.connectedAt ?? null,
  });
}

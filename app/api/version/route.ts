import { NextResponse } from "next/server";

// Identifies the currently-serving deployment so the wallboard can notice a
// new deploy and reload itself. On Vercel these system env vars are populated
// per deployment (commit SHA changes on every push); locally they're
// undefined, so we return "dev" — a stable value that never triggers a reload
// in development.
export const dynamic = "force-dynamic";

export function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { listTemplates, createTemplate } from "@/lib/releases/templates-store";
import type { ReleaseType } from "@/lib/releases/types";

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      platformPrefix?: string | null;
      releaseType?: ReleaseType | null;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const template = await createTemplate({
      name: body.name.trim(),
      platformPrefix: body.platformPrefix ?? null,
      releaseType: body.releaseType ?? null,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

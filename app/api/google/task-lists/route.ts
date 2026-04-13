import { NextResponse } from "next/server";
import { listTaskLists } from "@/lib/google/client";

export async function GET() {
  try {
    const taskLists = await listTaskLists();
    return NextResponse.json({ taskLists });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

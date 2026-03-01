import { NextResponse } from "next/server";
import { ingestSWEListJobs } from "@/lib/sync-ingestion";

export async function POST() {
  const startedAt = new Date().toISOString();

  try {
    const result = await ingestSWEListJobs();
    return NextResponse.json({
      ok: true,
      startedAt,
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync ingestion error";

    return NextResponse.json(
      {
        ok: false,
        startedAt,
        error: message
      },
      { status: 500 }
    );
  }
}

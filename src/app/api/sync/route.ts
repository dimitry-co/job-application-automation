import { NextResponse } from "next/server";
import { ingestSWEListJobs } from "@/lib/sync-ingestion";

export async function POST() {
  const startedAt = new Date().toISOString();

  try {
    const result = await ingestSWEListJobs();
    console.info("Sync ingestion completed.", {
      startedAt,
      ...result
    });

    return NextResponse.json({
      ok: true,
      startedAt,
      ...result
    });
  } catch (error) {
    console.error("Sync ingestion failed.", {
      startedAt,
      error
    });

    return NextResponse.json(
      {
        ok: false,
        startedAt,
        error: "Sync ingestion failed."
      },
      { status: 500 }
    );
  }
}

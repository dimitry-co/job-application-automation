import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toJobDTO } from "@/lib/job-dto";

export async function GET() {
  const jobs = await prisma.job.findMany({
    orderBy: {
      dateDiscovered: "desc"
    }
  });

  return NextResponse.json({ jobs: jobs.map(toJobDTO) });
}

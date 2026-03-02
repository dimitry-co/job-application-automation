import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canTransitionStatus, parseJobPatchPayload, toApiJobStatus, toJobDTO } from "@/lib/job-dto";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: {
      id
    }
  });

  return NextResponse.json({
    job: job ? toJobDTO(job) : null
  });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseJobPatchPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existingJob = await prisma.job.findUnique({
    where: {
      id
    }
  });

  if (!existingJob) {
    return NextResponse.json({ error: `Job "${id}" not found.` }, { status: 404 });
  }

  if (parsed.value.requestedStatus) {
    const currentStatus = toApiJobStatus(existingJob.status);
    if (!canTransitionStatus(currentStatus, parsed.value.requestedStatus)) {
      return NextResponse.json(
        {
          error: `Invalid status transition: ${currentStatus} -> ${parsed.value.requestedStatus}.`
        },
        { status: 400 }
      );
    }
  }

  const updatedJob = await prisma.job.update({
    where: {
      id
    },
    data: parsed.value.data
  });

  return NextResponse.json({
    job: toJobDTO(updatedJob)
  });
}

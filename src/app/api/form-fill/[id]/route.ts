import {
  FormFillStatus as PrismaFormFillStatus,
  JobStatus as PrismaJobStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autoFillApplication } from "@/lib/form-filler";
import { canTransitionStatus, toApiJobStatus, toJobDTO } from "@/lib/job-dto";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const FORM_FILL_FAILED_MESSAGE = "Form fill execution failed. Review screenshots/logs and retry.";

export async function POST(_: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const existingJob = await prisma.job.findUnique({
    where: {
      id
    }
  });

  if (!existingJob) {
    return NextResponse.json({ ok: false, error: `Job "${id}" not found.` }, { status: 404 });
  }

  const currentStatus = toApiJobStatus(existingJob.status);
  if (currentStatus === "form-filling") {
    return NextResponse.json(
      {
        ok: false,
        error: `Job "${id}" already has a form-fill run in progress.`
      },
      { status: 409 }
    );
  }

  if (!canTransitionStatus(currentStatus, "form-filling")) {
    return NextResponse.json(
      {
        ok: false,
        error: `Job "${id}" must be in a form-fill-ready state before running form fill.`
      },
      { status: 409 }
    );
  }

  const claimResult = await prisma.job.updateMany({
    where: {
      id,
      status: existingJob.status
    },
    data: {
      status: PrismaJobStatus.form_filling,
      formFillStatus: PrismaFormFillStatus.in_progress
    }
  });

  if (claimResult.count === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Job "${id}" state changed. Refresh and retry form fill.`
      },
      { status: 409 }
    );
  }

  try {
    const formFill = await autoFillApplication(existingJob.applicationUrl);
    const updatedJob = await prisma.job.update({
      where: {
        id
      },
      data: {
        status: PrismaJobStatus.form_ready,
        formFillStatus: PrismaFormFillStatus.awaiting_review,
        formScreenshots: formFill.screenshotPaths
      }
    });

    return NextResponse.json({
      ok: true,
      job: toJobDTO(updatedJob),
      formFill
    });
  } catch (error) {
    console.error("Form-fill execution failed", {
      jobId: id,
      error: error instanceof Error ? error.message : "Unknown error"
    });

    const failedJob = await prisma.job.update({
      where: {
        id
      },
      data: {
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed
      }
    });

    return NextResponse.json(
      {
        ok: false,
        error: FORM_FILL_FAILED_MESSAGE,
        job: toJobDTO(failedJob)
      },
      { status: 500 }
    );
  }
}

import {
  FormFillStatus as PrismaFormFillStatus,
  JobStatus as PrismaJobStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autoFillApplication, FormFillRunnerBusyError } from "@/lib/form-filler";
import { canTransitionStatus, toApiJobStatus, toJobDTO } from "@/lib/job-dto";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const FORM_FILL_FAILED_MESSAGE = "Form fill execution failed. Review screenshots/logs and retry.";
const MANUAL_ACTION_REQUIRED_MESSAGE =
  "Manual action required: security/login verification blocked automation. Complete it in browser, then retry form fill.";
const FORM_FILL_INCOMPLETE_MESSAGE =
  "Form fill did not reach a submit-ready state. Review captured screenshots/logs and retry.";
const RUNNER_BUSY_MESSAGE =
  "Another form-fill runner is already active. Wait for it to finish, then retry.";

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
    const runMetadata = {
      runId: formFill.runId,
      runDir: formFill.runDir,
      agentLogPath: formFill.agentLogPath,
      rawOutputPath: formFill.rawOutputPath
    };

    if (formFill.manualActionRequired) {
      const blockedJob = await prisma.job.update({
        where: {
          id
        },
        data: {
          status: PrismaJobStatus.ready,
          formFillStatus: PrismaFormFillStatus.failed,
          formScreenshots: formFill.screenshotPaths
        }
      });

      return NextResponse.json(
        {
          ok: false,
          error: MANUAL_ACTION_REQUIRED_MESSAGE,
          manualActionRequired: true,
          manualActionReason: formFill.manualActionReason,
          orderedReasons: formFill.orderedReasons,
          skillDeviationReasons: formFill.skillDeviationReasons,
          job: toJobDTO(blockedJob),
          formFill,
          ...runMetadata
        },
        { status: 409 }
      );
    }

    if (!formFill.stoppedAtSubmit) {
      const incompleteJob = await prisma.job.update({
        where: {
          id
        },
        data: {
          status: PrismaJobStatus.ready,
          formFillStatus: PrismaFormFillStatus.failed,
          formScreenshots: formFill.screenshotPaths
        }
      });

      return NextResponse.json(
        {
          ok: false,
          error: FORM_FILL_INCOMPLETE_MESSAGE,
          manualActionRequired: true,
          manualActionReason: "submit_not_reached",
          orderedReasons: formFill.orderedReasons,
          skillDeviationReasons: formFill.skillDeviationReasons,
          job: toJobDTO(incompleteJob),
          formFill,
          ...runMetadata
        },
        { status: 409 }
      );
    }

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
      formFill,
      ...runMetadata
    });
  } catch (error) {
    if (error instanceof FormFillRunnerBusyError) {
      const revertedJob = await prisma.job.update({
        where: {
          id
        },
        data: {
          status: PrismaJobStatus.ready,
          formFillStatus: PrismaFormFillStatus.pending
        }
      });

      return NextResponse.json(
        {
          ok: false,
          error: RUNNER_BUSY_MESSAGE,
          manualActionRequired: true,
          manualActionReason: "runner_busy",
          orderedReasons: ["runner_busy"],
          skillDeviationReasons: [],
          job: toJobDTO(revertedJob)
        },
        { status: 409 }
      );
    }

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

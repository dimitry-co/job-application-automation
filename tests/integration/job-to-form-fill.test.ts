import {
  FormFillStatus as PrismaFormFillStatus,
  JobSource as PrismaJobSource,
  JobStatus as PrismaJobStatus,
  type Job,
  type PrismaClient
} from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { autoFillApplicationMock, mockPrisma, formFillRunnerBusyErrorCtor } = vi.hoisted(() => {
  const prisma = {
    job: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn()
    }
  };

  const FormFillRunnerBusyError = class FormFillRunnerBusyError extends Error {};

  return {
    autoFillApplicationMock: vi.fn(),
    mockPrisma: prisma,
    formFillRunnerBusyErrorCtor: FormFillRunnerBusyError
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma as unknown as PrismaClient
}));

vi.mock("@/lib/form-filler", () => ({
  autoFillApplication: autoFillApplicationMock,
  FormFillRunnerBusyError: formFillRunnerBusyErrorCtor
}));

import { POST } from "@/app/api/form-fill/[id]/route";

function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    company: "Acme",
    role: "Software Engineer",
    location: "New York, NY",
    applicationUrl: "https://jobs.example.com/opening",
    source: PrismaJobSource.new_grad,
    datePosted: new Date("2026-01-10T00:00:00.000Z"),
    dateDiscovered: new Date("2026-01-11T00:00:00.000Z"),
    status: PrismaJobStatus.ready,
    resumeChoice: null,
    resumeRationale: null,
    jobDescription: null,
    formFillStatus: null,
    formScreenshots: null,
    notes: null,
    emailThreadId: null,
    ...overrides
  };
}

function formFillParams(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id })
  };
}

describe("job-to-form-fill integration", () => {
  beforeEach(() => {
    mockPrisma.job.findUnique.mockReset();
    mockPrisma.job.updateMany.mockReset();
    mockPrisma.job.update.mockReset();
    autoFillApplicationMock.mockReset();

    mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
  });

  test("returns 404 when job does not exist", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/missing", {
        method: "POST"
      }),
      formFillParams("missing")
    );
    const payload = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      ok: false,
      error: 'Job "missing" not found.'
    });
    expect(autoFillApplicationMock).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test("returns 409 when status cannot transition into form-filling", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(
      buildJob({
        status: PrismaJobStatus.submitted
      })
    );

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(409);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("must be in a form-fill-ready state");
    expect(autoFillApplicationMock).not.toHaveBeenCalled();
    expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test("returns 409 when a form-fill run is already in progress", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(
      buildJob({
        status: PrismaJobStatus.form_filling
      })
    );

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      ok: false,
      error: 'Job "job-1" already has a form-fill run in progress.'
    });
    expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    expect(autoFillApplicationMock).not.toHaveBeenCalled();
  });

  test("returns 409 when concurrent state change prevents claiming the run", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(buildJob());
    mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      ok: false,
      error: 'Job "job-1" state changed. Refresh and retry form fill.'
    });
    expect(autoFillApplicationMock).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test("runs form fill, persists success state, and returns job + formFill payload", async () => {
    const existingJob = buildJob({
      status: PrismaJobStatus.ready
    });
    const finalJob = buildJob({
      status: PrismaJobStatus.form_ready,
      formFillStatus: PrismaFormFillStatus.awaiting_review,
      formScreenshots: ["artifacts/form-fill-1717171717000.png"]
    });

    mockPrisma.job.findUnique.mockResolvedValue(existingJob);
    mockPrisma.job.update.mockResolvedValueOnce(finalJob);
    autoFillApplicationMock.mockResolvedValue({
      stoppedAtSubmit: true,
      screenshotPaths: ["artifacts/form-fill-1717171717000.png"],
      finalUrl: "https://jobs.example.com/opening#submit",
      manualActionRequired: false,
      manualActionReason: null,
      orderedReasons: [],
      skillDeviationReasons: [],
      runId: "run-1",
      runDir: "/tmp/run-1",
      agentLogPath: "/tmp/run-1/pane.log",
      rawOutputPath: "/tmp/run-1/last-message.txt"
    });

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as {
      ok: boolean;
      formFill: {
        stoppedAtSubmit: boolean;
        screenshotPaths: string[];
        finalUrl: string;
        manualActionRequired: boolean;
        manualActionReason: string | null;
        orderedReasons: string[];
        skillDeviationReasons: string[];
      };
      job: {
        status: string;
        formFillStatus: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: PrismaJobStatus.ready
      },
      data: {
        status: PrismaJobStatus.form_filling,
        formFillStatus: PrismaFormFillStatus.in_progress
      }
    });
    expect(autoFillApplicationMock).toHaveBeenCalledWith("https://jobs.example.com/opening");
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.form_ready,
        formFillStatus: PrismaFormFillStatus.awaiting_review,
        formScreenshots: ["artifacts/form-fill-1717171717000.png"]
      }
    });
    expect(payload.ok).toBe(true);
    expect(payload.formFill).toEqual(
      expect.objectContaining({
        stoppedAtSubmit: true,
        screenshotPaths: ["artifacts/form-fill-1717171717000.png"],
        finalUrl: "https://jobs.example.com/opening#submit",
        manualActionRequired: false,
        manualActionReason: null,
        orderedReasons: [],
        skillDeviationReasons: [],
        runId: "run-1",
        runDir: "/tmp/run-1",
        agentLogPath: "/tmp/run-1/pane.log",
        rawOutputPath: "/tmp/run-1/last-message.txt"
      })
    );
    expect(payload.job.status).toBe("form-ready");
    expect(payload.job.formFillStatus).toBe("awaiting-review");
    expect((payload as { runId?: string }).runId).toBe("run-1");
  });

  test("returns 409 with manual-action payload when anti-bot/security blocks automation", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(buildJob());
    mockPrisma.job.update.mockResolvedValueOnce(
      buildJob({
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed,
        formScreenshots: ["artifacts/form-fill-security.png"]
      })
    );
    autoFillApplicationMock.mockResolvedValue({
      stoppedAtSubmit: false,
      screenshotPaths: ["artifacts/form-fill-security.png"],
      finalUrl: "https://jobs.example.com/security-check",
      manualActionRequired: true,
      manualActionReason: "security_verification",
      orderedReasons: ["security_verification_page", "unable_to_reach_form"],
      skillDeviationReasons: ["inline_script_used_for_fallback"],
      runId: "run-security",
      runDir: "/tmp/run-security",
      agentLogPath: "/tmp/run-security/pane.log",
      rawOutputPath: "/tmp/run-security/last-message.txt"
    });

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error: string;
      manualActionRequired: boolean;
      manualActionReason: string | null;
      orderedReasons: string[];
      skillDeviationReasons: string[];
      formFill: {
        stoppedAtSubmit: boolean;
        screenshotPaths: string[];
        finalUrl: string;
        manualActionRequired: boolean;
        manualActionReason: string | null;
        orderedReasons: string[];
        skillDeviationReasons: string[];
      };
      job: { status: string; formFillStatus: string | null };
    };

    expect(response.status).toBe(409);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Manual action required");
    expect(payload.manualActionRequired).toBe(true);
    expect(payload.manualActionReason).toBe("security_verification");
    expect(payload.orderedReasons).toEqual(["security_verification_page", "unable_to_reach_form"]);
    expect(payload.skillDeviationReasons).toEqual(["inline_script_used_for_fallback"]);
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed,
        formScreenshots: ["artifacts/form-fill-security.png"]
      }
    });
    expect(payload.job.status).toBe("ready");
    expect(payload.job.formFillStatus).toBe("failed");
    expect(payload.formFill.manualActionRequired).toBe(true);
    expect(payload.formFill.orderedReasons).toEqual([
      "security_verification_page",
      "unable_to_reach_form"
    ]);
    expect(payload.formFill.skillDeviationReasons).toEqual(["inline_script_used_for_fallback"]);
  });

  test("returns 409 and marks failed when run completes without reaching submit", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(buildJob());
    mockPrisma.job.update.mockResolvedValueOnce(
      buildJob({
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed,
        formScreenshots: ["artifacts/form-fill-incomplete.png"]
      })
    );
    autoFillApplicationMock.mockResolvedValue({
      stoppedAtSubmit: false,
      screenshotPaths: ["artifacts/form-fill-incomplete.png"],
      finalUrl: "https://jobs.example.com/review",
      manualActionRequired: false,
      manualActionReason: null,
      orderedReasons: ["validation_failed"],
      skillDeviationReasons: [],
      runId: "run-incomplete",
      runDir: "/tmp/run-incomplete",
      agentLogPath: "/tmp/run-incomplete/pane.log",
      rawOutputPath: "/tmp/run-incomplete/last-message.txt"
    });

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error: string;
      manualActionReason: string;
      job: { status: string; formFillStatus: string | null };
    };

    expect(response.status).toBe(409);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("did not reach a submit-ready state");
    expect(payload.manualActionReason).toBe("submit_not_reached");
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed,
        formScreenshots: ["artifacts/form-fill-incomplete.png"]
      }
    });
    expect(payload.job.status).toBe("ready");
    expect(payload.job.formFillStatus).toBe("failed");
  });

  test("returns 409 and releases claim when runner lock is busy", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(buildJob());
    mockPrisma.job.update.mockResolvedValueOnce(
      buildJob({
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.pending
      })
    );
    autoFillApplicationMock.mockRejectedValue(
      new formFillRunnerBusyErrorCtor("runner is currently active")
    );

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error: string;
      manualActionReason: string;
      job: { status: string; formFillStatus: string | null };
    };

    expect(response.status).toBe(409);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("runner is already active");
    expect(payload.manualActionReason).toBe("runner_busy");
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.pending
      }
    });
    expect(payload.job.status).toBe("ready");
    expect(payload.job.formFillStatus).toBe("pending");
  });

  test("persists failed state and returns safe non-200 error when autofill fails", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(buildJob());
    mockPrisma.job.update.mockResolvedValueOnce(
      buildJob({
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed
      })
    );
    autoFillApplicationMock.mockRejectedValue(new Error("Playwright selector timed out"));

    const response = await POST(
      new NextRequest("http://localhost/api/form-fill/job-1", {
        method: "POST"
      }),
      formFillParams("job-1")
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error: string;
      job: { status: string; formFillStatus: string | null };
    };

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("Form fill execution failed. Review screenshots/logs and retry.");
    expect(payload.error).not.toContain("selector timed out");
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: PrismaJobStatus.ready
      },
      data: {
        status: PrismaJobStatus.form_filling,
        formFillStatus: PrismaFormFillStatus.in_progress
      }
    });
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.ready,
        formFillStatus: PrismaFormFillStatus.failed
      }
    });
    expect(payload.job.status).toBe("ready");
    expect(payload.job.formFillStatus).toBe("failed");
  });
});

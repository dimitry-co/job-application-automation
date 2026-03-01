import {
  FormFillStatus as PrismaFormFillStatus,
  JobSource as PrismaJobSource,
  JobStatus as PrismaJobStatus,
  ResumeChoice as PrismaResumeChoice,
  type Job,
  type PrismaClient
} from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET as getDashboardStats } from "@/app/api/dashboard/stats/route";
import { GET as getJobById, PATCH as patchJobById } from "@/app/api/jobs/[id]/route";
import { GET as getJobs } from "@/app/api/jobs/route";

const { mockPrisma } = vi.hoisted(() => {
  const prisma = {
    job: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn()
    },
    $transaction: vi.fn(async <T>(queries: Promise<T>[]) => Promise.all(queries))
  };

  return {
    mockPrisma: prisma
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma as unknown as PrismaClient
}));

function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    company: "Acme",
    role: "Software Engineer",
    location: "New York, NY",
    applicationUrl: "https://example.com/jobs/1",
    source: PrismaJobSource.new_grad,
    datePosted: new Date("2026-01-10T00:00:00.000Z"),
    dateDiscovered: new Date("2026-01-11T00:00:00.000Z"),
    status: PrismaJobStatus.new,
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

function jobParams(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id })
  };
}

describe("api routes integration", () => {
  beforeEach(() => {
    mockPrisma.job.findMany.mockReset();
    mockPrisma.job.findUnique.mockReset();
    mockPrisma.job.update.mockReset();
    mockPrisma.job.count.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation(async <T>(queries: Promise<T>[]) =>
      Promise.all(queries)
    );
  });

  test("GET /api/jobs returns mapped job DTOs", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      buildJob({
        source: PrismaJobSource.new_grad,
        status: PrismaJobStatus.form_filling,
        formFillStatus: PrismaFormFillStatus.awaiting_review
      })
    ]);

    const response = await getJobs();
    const payload = (await response.json()) as {
      jobs: Array<{
        source: string;
        status: string;
        formFillStatus: string | null;
        datePosted: string;
        dateDiscovered: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
      orderBy: {
        dateDiscovered: "desc"
      }
    });
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0].source).toBe("new-grad");
    expect(payload.jobs[0].status).toBe("form-filling");
    expect(payload.jobs[0].formFillStatus).toBe("awaiting-review");
    expect(payload.jobs[0].datePosted).toBe("2026-01-10T00:00:00.000Z");
    expect(payload.jobs[0].dateDiscovered).toBe("2026-01-11T00:00:00.000Z");
  });

  test("GET /api/jobs/:id returns null when job does not exist", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(null);

    const response = await getJobById(
      new NextRequest("http://localhost/api/jobs/missing"),
      jobParams("missing")
    );
    const payload = (await response.json()) as { job: unknown | null };

    expect(response.status).toBe(200);
    expect(payload.job).toBeNull();
  });

  test("PATCH /api/jobs/:id rejects disallowed fields", async () => {
    const response = await patchJobById(
      new NextRequest("http://localhost/api/jobs/job-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          unexpected: true
        })
      }),
      jobParams("job-1")
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Field "unexpected" is not allowed');
    expect(mockPrisma.job.findUnique).not.toHaveBeenCalled();
  });

  test("PATCH /api/jobs/:id blocks invalid status transitions", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(
      buildJob({
        status: PrismaJobStatus.new
      })
    );

    const response = await patchJobById(
      new NextRequest("http://localhost/api/jobs/job-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          status: "submitted"
        })
      }),
      jobParams("job-1")
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Invalid status transition");
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test("PATCH /api/jobs/:id updates and returns mapped DTO", async () => {
    mockPrisma.job.findUnique.mockResolvedValue(
      buildJob({
        status: PrismaJobStatus.new
      })
    );
    mockPrisma.job.update.mockResolvedValue(
      buildJob({
        status: PrismaJobStatus.reviewing,
        source: PrismaJobSource.new_grad,
        resumeChoice: PrismaResumeChoice.student,
        resumeRationale: "Student resume has stronger project alignment.",
        formFillStatus: PrismaFormFillStatus.in_progress
      })
    );

    const response = await patchJobById(
      new NextRequest("http://localhost/api/jobs/job-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          status: "reviewing",
          source: "new-grad",
          resumeChoice: "student",
          resumeRationale: "Student resume has stronger project alignment.",
          formFillStatus: "in-progress"
        })
      }),
      jobParams("job-1")
    );
    const payload = (await response.json()) as {
      job: {
        status: string;
        source: string;
        resumeChoice: string | null;
        formFillStatus: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: {
        id: "job-1"
      },
      data: {
        status: PrismaJobStatus.reviewing,
        source: PrismaJobSource.new_grad,
        resumeChoice: PrismaResumeChoice.student,
        resumeRationale: "Student resume has stronger project alignment.",
        formFillStatus: PrismaFormFillStatus.in_progress
      }
    });
    expect(payload.job.status).toBe("reviewing");
    expect(payload.job.source).toBe("new-grad");
    expect(payload.job.resumeChoice).toBe("student");
    expect(payload.job.formFillStatus).toBe("in-progress");
  });

  test("GET /api/dashboard/stats returns computed DB counts", async () => {
    mockPrisma.job.count
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const response = await getDashboardStats();
    const payload = (await response.json()) as {
      total: number;
      pending: number;
      submitted: number;
      accepted: number;
      rejected: number;
    };

    expect(response.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.job.count).toHaveBeenNthCalledWith(1);
    expect(mockPrisma.job.count).toHaveBeenNthCalledWith(2, {
      where: {
        status: {
          in: [
            PrismaJobStatus.new,
            PrismaJobStatus.reviewing,
            PrismaJobStatus.ready,
            PrismaJobStatus.form_filling,
            PrismaJobStatus.form_ready
          ]
        }
      }
    });
    expect(mockPrisma.job.count).toHaveBeenNthCalledWith(3, {
      where: {
        status: PrismaJobStatus.submitted
      }
    });
    expect(mockPrisma.job.count).toHaveBeenNthCalledWith(4, {
      where: {
        status: PrismaJobStatus.accepted
      }
    });
    expect(mockPrisma.job.count).toHaveBeenNthCalledWith(5, {
      where: {
        status: PrismaJobStatus.rejected
      }
    });
    expect(payload).toEqual({
      total: 11,
      pending: 6,
      submitted: 2,
      accepted: 2,
      rejected: 1
    });
  });
});

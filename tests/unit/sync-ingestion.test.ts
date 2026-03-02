import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SWEListEmail } from "@/lib/gmail";

const { getSWEListEmailsMock, createMock } = vi.hoisted(() => ({
  getSWEListEmailsMock: vi.fn(),
  createMock: vi.fn()
}));

vi.mock("@/lib/gmail", () => ({
  getSWEListEmails: getSWEListEmailsMock
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      create: createMock
    }
  }
}));

import { ingestSWEListJobs } from "@/lib/sync-ingestion";

function createEmail(overrides: Partial<SWEListEmail>): SWEListEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    subject: "102 New Jobs Posted Today",
    html: "",
    text: "",
    datePosted: new Date("2026-02-20T00:00:00.000Z"),
    snippet: "",
    headers: {},
    ...overrides
  };
}

describe("ingestSWEListJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("persists parsed jobs and skips duplicates by source + applicationUrl", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        subject: "102 New Jobs Posted Today",
        html: [
          '<a href="https://existing.dev/apply">Existing Co: Software Engineer</a> Remote',
          '<a href="https://newco.dev/apply">New Co: Backend Engineer</a> Remote',
          '<a href="https://newco.dev/apply">New Co: Backend Engineer</a> Remote'
        ].join("\n")
      }),
      createEmail({
        id: "msg-2",
        threadId: "thread-2",
        subject: "99 New Internships Posted Today",
        html: [
          '<a href="https://newco.dev/apply">New Co: Software Engineer Intern</a> Remote',
          '<a href="https://another.dev/apply">Another Co: SWE Intern</a> Remote'
        ].join("\n")
      })
    ]);

    createMock.mockImplementation(async ({ data }: { data: { applicationUrl: string } }) => {
      if (data.applicationUrl === "https://existing.dev/apply") {
        throw { code: "P2002" };
      }
      return { id: "created" };
    });

    const result = await ingestSWEListJobs();

    expect(createMock).toHaveBeenCalledTimes(4);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        company: "Existing Co",
        applicationUrl: "https://existing.dev/apply",
        source: "new_grad",
        status: "new"
      })
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        company: "New Co",
        applicationUrl: "https://newco.dev/apply",
        source: "new_grad",
        status: "new"
      })
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        company: "New Co",
        applicationUrl: "https://newco.dev/apply",
        source: "internship",
        status: "new"
      })
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        company: "Another Co",
        applicationUrl: "https://another.dev/apply",
        source: "internship",
        status: "new"
      })
    });

    expect(result).toEqual({
      discovered: 5,
      created: 3,
      skipped: 2
    });
  });

  test("returns zero counters when no candidate jobs are parsed", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: "<p>No outbound links in this digest.</p>"
      })
    ]);

    const result = await ingestSWEListJobs();

    expect(createMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      discovered: 0,
      created: 0,
      skipped: 0
    });
  });

  test("rethrows non-unique database errors", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: '<a href="https://broken.dev/apply">Broken Co: SWE</a> Remote'
      })
    ]);

    createMock.mockRejectedValue(new Error("database unavailable"));

    await expect(ingestSWEListJobs()).rejects.toThrow("database unavailable");
  });
});

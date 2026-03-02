import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SWEListEmail } from "@/lib/gmail";

const { getSWEListEmailsMock, findManyMock, createManyMock } = vi.hoisted(() => ({
  getSWEListEmailsMock: vi.fn(),
  findManyMock: vi.fn(),
  createManyMock: vi.fn()
}));

vi.mock("@/lib/gmail", () => ({
  getSWEListEmails: getSWEListEmailsMock
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      findMany: findManyMock,
      createMany: createManyMock
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

    findManyMock.mockResolvedValue([
      {
        applicationUrl: "https://existing.dev/apply",
        source: "new_grad"
      }
    ]);
    createManyMock.mockResolvedValue({ count: 3 });

    const result = await ingestSWEListJobs();

    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(createManyMock).toHaveBeenCalledTimes(1);
    expect(createManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          company: "New Co",
          applicationUrl: "https://newco.dev/apply",
          source: "new_grad",
          status: "new"
        }),
        expect.objectContaining({
          company: "New Co",
          applicationUrl: "https://newco.dev/apply",
          source: "internship",
          status: "new"
        }),
        expect.objectContaining({
          company: "Another Co",
          applicationUrl: "https://another.dev/apply",
          source: "internship",
          status: "new"
        })
      ])
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

    expect(findManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      discovered: 0,
      created: 0,
      skipped: 0
    });
  });
});

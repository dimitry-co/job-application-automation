import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SWEListEmail } from "@/lib/gmail";

const { getSWEListEmailsMock, findUniqueMock, upsertMock, createManyMock } = vi.hoisted(() => ({
  getSWEListEmailsMock: vi.fn(),
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  createManyMock: vi.fn()
}));

vi.mock("@/lib/gmail", () => ({
  getSWEListEmails: getSWEListEmailsMock
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    emailSyncState: {
      findUnique: findUniqueMock,
      upsert: upsertMock
    },
    job: {
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
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({
      id: "singleton",
      lastSyncedAt: new Date("2026-02-20T00:00:00.000Z"),
      lastHistoryId: null
    });
    createManyMock.mockResolvedValue({ count: 0 });
  });

  test("persists parsed jobs with createMany + skipDuplicates", async () => {
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
    createManyMock.mockResolvedValue({ count: 3 });

    const result = await ingestSWEListJobs();

    expect(getSWEListEmailsMock).toHaveBeenCalledWith({
      maxResults: 5,
      afterDate: undefined
    });
    expect(createManyMock).toHaveBeenCalledTimes(1);
    expect(createManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          company: "Existing Co",
          applicationUrl: "https://existing.dev/apply",
          source: "new_grad",
          status: "new"
        }),
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
      ]),
      skipDuplicates: true
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      discovered: 5,
      created: 3,
      skipped: 2
    });
  });

  test("uses incremental sync state and only parses the two newest emails", async () => {
    const lastSyncedAt = new Date("2026-02-24T12:00:00.000Z");
    findUniqueMock.mockResolvedValue({
      id: "singleton",
      lastSyncedAt,
      lastHistoryId: null
    });

    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        id: "msg-newest",
        html: '<a href="https://newest.dev/apply">Newest Co: SWE</a> Remote'
      }),
      createEmail({
        id: "msg-second",
        html: '<a href="https://second.dev/apply">Second Co: SWE</a> Remote'
      }),
      createEmail({
        id: "msg-third",
        html: '<a href="https://third.dev/apply">Third Co: SWE</a> Remote'
      })
    ]);
    createManyMock.mockResolvedValue({ count: 2 });

    const result = await ingestSWEListJobs();

    expect(getSWEListEmailsMock).toHaveBeenCalledWith({
      maxResults: 5,
      afterDate: lastSyncedAt
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ applicationUrl: "https://newest.dev/apply" }),
        expect.objectContaining({ applicationUrl: "https://second.dev/apply" })
      ]),
      skipDuplicates: true
    });
    expect(createManyMock).not.toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ applicationUrl: "https://third.dev/apply" })
      ]),
      skipDuplicates: true
    });
    expect(result).toEqual({
      discovered: 2,
      created: 2,
      skipped: 0
    });
  });

  test("updates sync state even when no candidate jobs are parsed", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: "<p>No outbound links in this digest.</p>"
      })
    ]);

    const result = await ingestSWEListJobs();

    expect(createManyMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      discovered: 0,
      created: 0,
      skipped: 0
    });
  });

  test("rethrows createMany errors and does not update sync state", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: '<a href="https://broken.dev/apply">Broken Co: SWE</a> Remote'
      })
    ]);
    createManyMock.mockRejectedValue(new Error("database unavailable"));

    await expect(ingestSWEListJobs()).rejects.toThrow("database unavailable");
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

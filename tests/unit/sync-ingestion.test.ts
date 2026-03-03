import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SWEListEmail } from "@/lib/gmail";

const { getSWEListEmailsMock, findUniqueMock, upsertMock, transactionMock, createMock } =
  vi.hoisted(() => ({
    getSWEListEmailsMock: vi.fn(),
    findUniqueMock: vi.fn(),
    upsertMock: vi.fn(),
    transactionMock: vi.fn(),
    createMock: vi.fn()
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
    $transaction: transactionMock
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
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        job: {
          create: createMock
        }
      })
    );
  });

  test("persists parsed jobs and skips unique conflicts in transaction loop", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        subject: "102 New Jobs Posted Today",
        html: [
          '<a href="https://existing.dev/apply">Existing Co: Software Engineer</a> Remote (US)',
          '<a href="https://newco.dev/apply">New Co: Backend Engineer</a> Remote (US)',
          '<a href="https://newco.dev/apply">New Co: Backend Engineer</a> Remote (US)'
        ].join("\n")
      }),
      createEmail({
        id: "msg-2",
        threadId: "thread-2",
        subject: "99 New Internships Posted Today",
        html: [
          '<a href="https://newco.dev/apply">New Co: Software Engineer Intern</a> Remote (US)',
          '<a href="https://another.dev/apply">Another Co: SWE Intern</a> Remote (US)'
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

    expect(getSWEListEmailsMock).toHaveBeenCalledWith({
      maxResults: 5,
      afterDate: undefined
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
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
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      discovered: 5,
      created: 3,
      skipped: 2
    });
  });

  test("uses incremental sync state and processes oldest pending emails first", async () => {
    const lastSyncedAt = new Date("2026-02-24T12:00:00.000Z");
    const oldest = new Date("2026-02-24T12:01:00.000Z");
    const middle = new Date("2026-02-24T12:02:00.000Z");
    const newest = new Date("2026-02-24T12:03:00.000Z");
    findUniqueMock.mockResolvedValue({
      id: "singleton",
      lastSyncedAt,
      lastHistoryId: null
    });

    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        id: "msg-newest",
        datePosted: newest,
        html: '<a href="https://newest.dev/apply">Newest Co: SWE</a> Remote (US)'
      }),
      createEmail({
        id: "msg-second",
        datePosted: middle,
        html: '<a href="https://second.dev/apply">Second Co: SWE</a> Remote (US)'
      }),
      createEmail({
        id: "msg-third",
        datePosted: oldest,
        html: '<a href="https://third.dev/apply">Third Co: SWE</a> Remote (US)'
      })
    ]);
    createMock.mockResolvedValue({ id: "created" });

    const result = await ingestSWEListJobs();

    expect(getSWEListEmailsMock).toHaveBeenCalledWith({
      maxResults: 5,
      afterDate: lastSyncedAt
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(2);
    const createdUrls = createMock.mock.calls.map(
      (call) => (call[0] as { data: { applicationUrl: string } }).data.applicationUrl
    );
    expect(createdUrls).toEqual(["https://third.dev/apply", "https://second.dev/apply"]);
    expect(result).toEqual({
      discovered: 2,
      created: 2,
      skipped: 0
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        lastSyncedAt: middle
      },
      update: {
        lastSyncedAt: middle
      }
    });
  });

  test("updates sync state even when no candidate jobs are parsed", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: "<p>No outbound links in this digest.</p>"
      })
    ]);

    const result = await ingestSWEListJobs();

    expect(transactionMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      discovered: 0,
      created: 0,
      skipped: 0
    });
  });

  test("rethrows non-unique database errors and does not update sync state", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: '<a href="https://broken.dev/apply">Broken Co: SWE</a> Remote (US)'
      })
    ]);
    createMock.mockRejectedValue(new Error("database unavailable"));

    await expect(ingestSWEListJobs()).rejects.toThrow("database unavailable");
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

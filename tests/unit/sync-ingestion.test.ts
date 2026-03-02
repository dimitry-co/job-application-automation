import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SWEListEmail } from "@/lib/gmail";

const { getSWEListEmailsMock, createMock, transactionMock } = vi.hoisted(() => ({
  getSWEListEmailsMock: vi.fn(),
  createMock: vi.fn(),
  transactionMock: vi.fn()
}));

vi.mock("@/lib/gmail", () => ({
  getSWEListEmails: getSWEListEmailsMock
}));

vi.mock("@/lib/db", () => ({
  prisma: {
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
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        job: {
          create: createMock
        }
      })
    );
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

    expect(result).toEqual({
      discovered: 5,
      created: 3,
      skipped: 2
    });
    expect(infoSpy).toHaveBeenCalledWith(
      "Sync ingestion skipped duplicates due to unique constraint.",
      expect.objectContaining({
        uniqueConstraintSkips: 1
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("returns zero counters when no candidate jobs are parsed", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: "<p>No outbound links in this digest.</p>"
      })
    ]);

    const result = await ingestSWEListJobs();

    expect(transactionMock).not.toHaveBeenCalled();
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
    expect(errorSpy).toHaveBeenCalledWith(
      "Sync ingestion persistence failed.",
      expect.objectContaining({
        applicationUrl: "https://broken.dev/apply",
        source: "new_grad",
        error: expect.any(Error)
      })
    );
  });

  test("stops processing remaining candidates after non-unique failure", async () => {
    getSWEListEmailsMock.mockResolvedValue([
      createEmail({
        html: [
          '<a href="https://one.dev/apply">One Co: SWE</a> Remote',
          '<a href="https://two.dev/apply">Two Co: SWE</a> Remote',
          '<a href="https://three.dev/apply">Three Co: SWE</a> Remote'
        ].join("\n")
      })
    ]);

    let callCount = 0;
    createMock.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("database unavailable");
      }
      return { id: String(callCount) };
    });

    await expect(ingestSWEListJobs()).rejects.toThrow("database unavailable");
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

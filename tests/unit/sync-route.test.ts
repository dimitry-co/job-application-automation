import { beforeEach, describe, expect, test, vi } from "vitest";

const { ingestSWEListJobsMock } = vi.hoisted(() => ({
  ingestSWEListJobsMock: vi.fn()
}));

vi.mock("@/lib/sync-ingestion", () => ({
  ingestSWEListJobs: ingestSWEListJobsMock
}));

import { POST } from "@/app/api/sync/route";

describe("POST /api/sync", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("returns sync counters on success", async () => {
    ingestSWEListJobsMock.mockResolvedValue({
      discovered: 12,
      created: 8,
      skipped: 4
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      discovered: 12,
      created: 8,
      skipped: 4
    });
    expect(typeof body.startedAt).toBe("string");
    expect(Number.isNaN(new Date(body.startedAt).getTime())).toBe(false);
    expect(infoSpy).toHaveBeenCalledWith(
      "Sync ingestion completed.",
      expect.objectContaining({
        discovered: 12,
        created: 8,
        skipped: 4
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("returns non-200 error payload when sync ingestion fails", async () => {
    ingestSWEListJobsMock.mockRejectedValue(new Error("Gmail sync failed"));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      error: "Sync ingestion failed."
    });
    expect(body.error).not.toContain("Gmail sync failed");
    expect(typeof body.startedAt).toBe("string");
    expect(errorSpy).toHaveBeenCalledWith(
      "Sync ingestion failed.",
      expect.objectContaining({
        error: expect.any(Error)
      })
    );
  });
});

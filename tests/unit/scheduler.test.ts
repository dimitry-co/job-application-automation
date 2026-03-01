import { describe, expect, test, vi } from "vitest";
import { startScheduler } from "@/lib/scheduler";

describe("startScheduler", () => {
  test("returns a scheduled task", () => {
    const task = startScheduler({
      ingest: vi.fn(async () => {}),
      analyze: vi.fn(async () => {}),
      track: vi.fn(async () => {})
    });
    expect(task).toBeDefined();
    task.stop();
  });
});

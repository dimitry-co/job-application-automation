import { describe, expect, test } from "vitest";
import { analyzeResumeMatch } from "@/lib/resume-analyzer";

describe("analyzeResumeMatch", () => {
  test("returns heuristic recommendation when api key missing", async () => {
    const result = await analyzeResumeMatch("Internship role");
    expect(["student", "experienced"]).toContain(result.recommendation);
  });
});

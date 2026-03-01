import { describe, expect, test } from "vitest";
import { buildFieldMappingPrompt } from "@/lib/form-filler-prompts";

describe("buildFieldMappingPrompt", () => {
  test("includes context fields", () => {
    const prompt = buildFieldMappingPrompt({
      jobTitle: "Software Engineer",
      company: "Acme",
      profileText: "TypeScript"
    });
    expect(prompt).toContain("Software Engineer");
    expect(prompt).toContain("Acme");
  });
});

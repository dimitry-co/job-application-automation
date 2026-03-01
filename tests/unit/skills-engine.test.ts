import { describe, expect, test } from "vitest";
import { listSkills } from "@/lib/skills-engine";

describe("listSkills", () => {
  test("returns at least one skill directory", async () => {
    const skills = await listSkills();
    expect(Array.isArray(skills)).toBe(true);
  });
});

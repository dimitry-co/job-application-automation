import { describe, expect, test } from "vitest";
import { prepareApplication } from "@/lib/application-preparer";

describe("prepareApplication", () => {
  test("returns summary", async () => {
    const prepared = await prepareApplication("Entry level software engineer");
    expect(prepared.summary.length).toBeGreaterThan(0);
  });
});

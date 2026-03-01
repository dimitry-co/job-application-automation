import { describe, expect, test } from "vitest";
import { parseSWEListHtml } from "@/lib/email-parser";

describe("parseSWEListHtml", () => {
  test("extracts entries from links", () => {
    const html = '<a href="https://example.com">Acme: Software Engineer</a> Remote';
    const jobs = parseSWEListHtml(html, "New Jobs", new Date("2026-01-01T00:00:00.000Z"));
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.company).toBe("Acme");
  });
});

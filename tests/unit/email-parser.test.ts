import { describe, expect, test } from "vitest";
import { parseSWEListHtml } from "@/lib/email-parser";

describe("parseSWEListHtml", () => {
  test("extracts US remote entries from digest links", () => {
    const html = '<a href="https://example.com">Acme: Software Engineer</a> Remote (US)';
    const jobs = parseSWEListHtml(
      html,
      "102 New Jobs Posted Today",
      new Date("2026-01-01T00:00:00.000Z")
    );

    expect(jobs.length).toBe(1);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        company: "Acme",
        role: "Software Engineer",
        location: "Remote (US)",
        source: "new-grad"
      })
    );
  });

  test("excludes non-US locations", () => {
    const html =
      '<a href="https://example.com">Globex: Backend Engineer</a> Berlin, Germany (On-site)';
    const jobs = parseSWEListHtml(
      html,
      "99 New Internships Posted Today",
      new Date("2026-01-01T00:00:00.000Z")
    );

    expect(jobs).toEqual([]);
  });

  test("does not treat generic two-letter uppercase tokens as US location", () => {
    const html =
      '<a href="https://example.com">Contoso: QA Engineer</a> Work with QA stakeholders globally';
    const jobs = parseSWEListHtml(
      html,
      "102 New Jobs Posted Today",
      new Date("2026-01-01T00:00:00.000Z")
    );

    expect(jobs).toEqual([]);
  });
});

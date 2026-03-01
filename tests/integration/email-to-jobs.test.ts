import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseSWEListHtml } from "@/lib/email-parser";
import { parseRawEmlMessage } from "@/lib/gmail";

async function loadRawEml(fileName: string): Promise<string> {
  const samplePath = path.join(process.cwd(), "samples", "swemail", fileName);
  return fs.readFile(samplePath, "utf8");
}

describe("email-to-jobs integration", () => {
  test("parses internship digest .eml into job rows", async () => {
    const raw = await loadRawEml("✨ 99 New Internships Posted Today.eml");
    const email = parseRawEmlMessage(raw);
    const jobs = parseSWEListHtml(email.html, email.subject, email.datePosted);

    expect(email.subject).toContain("Internships");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((job) => job.applicationUrl.includes("simplify.jobs"))).toBe(true);
    expect(jobs.every((job) => job.source === "internship")).toBe(true);
    expect(jobs.every((job) => job.company.length > 0 && job.role.length > 0)).toBe(true);
  });

  test("parses new-grad digest .eml and classifies source correctly", async () => {
    const raw = await loadRawEml("✨ 103 New Jobs Posted Today.eml");
    const email = parseRawEmlMessage(raw);
    const jobs = parseSWEListHtml(email.html, email.subject, email.datePosted);

    expect(email.subject).toContain("New Jobs");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.source === "new-grad")).toBe(true);
  });
});

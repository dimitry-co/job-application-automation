import type { JobSource } from "@prisma/client";
import { parseSWEListHtml } from "@/lib/email-parser";
import { prisma } from "@/lib/db";
import { getSWEListEmails } from "@/lib/gmail";
import type { ParsedSWEListJob } from "@/types";

export interface SyncIngestionResult {
  discovered: number;
  created: number;
  skipped: number;
}

function toPrismaSource(source: ParsedSWEListJob["source"]): JobSource {
  return source === "internship" ? "internship" : "new_grad";
}

function normalizeApplicationUrl(applicationUrl: string): string {
  return applicationUrl.trim();
}

function buildCandidateKey(source: JobSource, applicationUrl: string): string {
  return `${source}:${applicationUrl}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return (error as { code?: string }).code === "P2002";
}

function coerceDatePosted(datePosted: Date): Date {
  return Number.isNaN(datePosted.getTime()) ? new Date() : datePosted;
}

function toPersistenceRecord(candidate: ParsedSWEListJob) {
  return {
    company: candidate.company.trim(),
    role: candidate.role.trim(),
    location: candidate.location.trim(),
    applicationUrl: normalizeApplicationUrl(candidate.applicationUrl),
    source: toPrismaSource(candidate.source),
    status: "new" as const,
    datePosted: coerceDatePosted(candidate.datePosted)
  };
}

export async function ingestSWEListJobs(maxResults = 25): Promise<SyncIngestionResult> {
  const emails = await getSWEListEmails(maxResults);
  const parsedCandidates = emails.flatMap((email) =>
    parseSWEListHtml(email.html, email.subject, email.datePosted)
  );

  const discovered = parsedCandidates.length;
  if (discovered === 0) {
    return { discovered: 0, created: 0, skipped: 0 };
  }

  const uniqueCandidates = new Map<string, ReturnType<typeof toPersistenceRecord>>();
  for (const candidate of parsedCandidates) {
    const record = toPersistenceRecord(candidate);
    const key = buildCandidateKey(record.source, record.applicationUrl);
    if (!record.applicationUrl || uniqueCandidates.has(key)) {
      continue;
    }
    uniqueCandidates.set(key, record);
  }

  const deduped = Array.from(uniqueCandidates.values());
  if (deduped.length === 0) {
    return { discovered, created: 0, skipped: discovered };
  }

  const outcomes = await Promise.all(
    deduped.map(async (candidate) => {
      try {
        await prisma.job.create({
          data: candidate
        });
        return "created";
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return "skipped";
        }
        throw error;
      }
    })
  );

  const created = outcomes.filter((outcome) => outcome === "created").length;

  return {
    discovered,
    created,
    skipped: discovered - created
  };
}

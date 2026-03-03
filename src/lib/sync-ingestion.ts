import type { JobSource } from "@prisma/client";
import { parseSWEListHtml } from "@/lib/email-parser";
import { prisma } from "@/lib/db";
import { getSWEListEmails, type SWEListEmail } from "@/lib/gmail";
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

const SYNC_STATE_SINGLETON_ID = "singleton";
const INCREMENTAL_SYNC_MAX_RESULTS = 5;
const INCREMENTAL_EMAILS_TO_PROCESS = 2;

async function markSyncComplete(lastSyncedAt: Date): Promise<void> {
  await prisma.emailSyncState.upsert({
    where: { id: SYNC_STATE_SINGLETON_ID },
    create: {
      id: SYNC_STATE_SINGLETON_ID,
      lastSyncedAt
    },
    update: {
      lastSyncedAt
    }
  });
}

function getTimestamp(value: Date): number | null {
  return Number.isNaN(value.getTime()) ? null : value.getTime();
}

function sortByDateAscending(emails: SWEListEmail[]): SWEListEmail[] {
  return [...emails].sort((a, b) => {
    const aTimestamp = getTimestamp(a.datePosted) ?? Number.MAX_SAFE_INTEGER;
    const bTimestamp = getTimestamp(b.datePosted) ?? Number.MAX_SAFE_INTEGER;
    return aTimestamp - bTimestamp;
  });
}

function resolveNextSyncCursor(emails: SWEListEmail[], fallback: Date): Date {
  let maxTimestamp: number | null = null;

  for (const email of emails) {
    const timestamp = getTimestamp(email.datePosted);
    if (timestamp === null) {
      continue;
    }

    if (maxTimestamp === null || timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  }

  if (maxTimestamp === null) {
    return fallback;
  }

  return new Date(maxTimestamp);
}

export async function ingestSWEListJobs(): Promise<SyncIngestionResult> {
  const syncState = await prisma.emailSyncState.findUnique({
    where: { id: SYNC_STATE_SINGLETON_ID }
  });
  const isIncrementalSync = Boolean(syncState);

  const fetchedEmails = await getSWEListEmails({
    maxResults: INCREMENTAL_SYNC_MAX_RESULTS,
    afterDate: syncState?.lastSyncedAt
  });
  const normalizedEmails = isIncrementalSync ? sortByDateAscending(fetchedEmails) : fetchedEmails;
  const emails = isIncrementalSync
    ? normalizedEmails.slice(0, INCREMENTAL_EMAILS_TO_PROCESS)
    : normalizedEmails;

  const parsedCandidates = emails.flatMap((email) =>
    parseSWEListHtml(email.html, email.subject, email.datePosted)
  );
  const completedAt = resolveNextSyncCursor(emails, new Date());

  const discovered = parsedCandidates.length;
  if (discovered === 0) {
    await markSyncComplete(completedAt);
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
    await markSyncComplete(completedAt);
    return { discovered, created: 0, skipped: discovered };
  }

  let created = 0;

  await prisma.$transaction(async (tx) => {
    for (const candidate of deduped) {
      try {
        await tx.job.create({
          data: candidate
        });
        created += 1;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }
    }
  });

  await markSyncComplete(completedAt);

  return {
    discovered,
    created,
    skipped: discovered - created
  };
}

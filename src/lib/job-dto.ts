import {
  FormFillStatus as PrismaFormFillStatus,
  JobSource as PrismaJobSource,
  JobStatus as PrismaJobStatus,
  ResumeChoice as PrismaResumeChoice,
  type Job,
  type Prisma
} from "@prisma/client";
import {
  FORM_FILL_STATUSES,
  JOB_SOURCES,
  JOB_STATUSES,
  RESUME_CHOICES,
  type FormFillStatus,
  type JobDTO,
  type JobSource,
  type JobStatus,
  type ResumeChoice
} from "@/types";

const PRISMA_TO_API_JOB_STATUS: Record<PrismaJobStatus, JobStatus> = {
  new: "new",
  reviewing: "reviewing",
  ready: "ready",
  form_filling: "form-filling",
  form_ready: "form-ready",
  submitted: "submitted",
  accepted: "accepted",
  rejected: "rejected",
  closed: "closed"
};

const API_TO_PRISMA_JOB_STATUS: Record<JobStatus, PrismaJobStatus> = {
  new: PrismaJobStatus.new,
  reviewing: PrismaJobStatus.reviewing,
  ready: PrismaJobStatus.ready,
  "form-filling": PrismaJobStatus.form_filling,
  "form-ready": PrismaJobStatus.form_ready,
  submitted: PrismaJobStatus.submitted,
  accepted: PrismaJobStatus.accepted,
  rejected: PrismaJobStatus.rejected,
  closed: PrismaJobStatus.closed
};

const PRISMA_TO_API_JOB_SOURCE: Record<PrismaJobSource, JobSource> = {
  new_grad: "new-grad",
  internship: "internship"
};

const API_TO_PRISMA_JOB_SOURCE: Record<JobSource, PrismaJobSource> = {
  "new-grad": PrismaJobSource.new_grad,
  internship: PrismaJobSource.internship
};

const PRISMA_TO_API_FORM_FILL_STATUS: Record<PrismaFormFillStatus, FormFillStatus> = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "completed",
  failed: "failed",
  awaiting_review: "awaiting-review"
};

const API_TO_PRISMA_FORM_FILL_STATUS: Record<FormFillStatus, PrismaFormFillStatus> = {
  pending: PrismaFormFillStatus.pending,
  "in-progress": PrismaFormFillStatus.in_progress,
  completed: PrismaFormFillStatus.completed,
  failed: PrismaFormFillStatus.failed,
  "awaiting-review": PrismaFormFillStatus.awaiting_review
};

const API_TO_PRISMA_RESUME_CHOICE: Record<ResumeChoice, PrismaResumeChoice> = {
  student: PrismaResumeChoice.student,
  experienced: PrismaResumeChoice.experienced
};

export const ALLOWED_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  new: ["reviewing"],
  reviewing: ["ready"],
  ready: ["form-filling"],
  "form-filling": ["form-ready", "ready"],
  "form-ready": ["submitted"],
  submitted: ["accepted", "rejected", "closed"],
  accepted: [],
  rejected: [],
  closed: []
};

const PATCHABLE_JOB_FIELDS = [
  "company",
  "role",
  "location",
  "applicationUrl",
  "source",
  "datePosted",
  "status",
  "resumeChoice",
  "resumeRationale",
  "formFillStatus"
] as const;

type PatchableJobField = (typeof PATCHABLE_JOB_FIELDS)[number];

const PATCHABLE_FIELDS_SET = new Set<string>(PATCHABLE_JOB_FIELDS);

type ParsedPatchResult =
  | {
      ok: true;
      value: {
        data: Prisma.JobUpdateInput;
        requestedStatus: JobStatus | null;
      };
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringEnumValue<T extends readonly string[]>(
  value: string,
  allowed: T
): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function isPatchableField(field: string): field is PatchableJobField {
  return PATCHABLE_FIELDS_SET.has(field);
}

export function toApiJobStatus(status: PrismaJobStatus): JobStatus {
  return PRISMA_TO_API_JOB_STATUS[status];
}

export function toPrismaJobStatus(status: JobStatus): PrismaJobStatus {
  return API_TO_PRISMA_JOB_STATUS[status];
}

export function toPrismaJobSource(source: JobSource): PrismaJobSource {
  return API_TO_PRISMA_JOB_SOURCE[source];
}

export function toPrismaFormFillStatus(status: FormFillStatus): PrismaFormFillStatus {
  return API_TO_PRISMA_FORM_FILL_STATUS[status];
}

export function canTransitionStatus(from: JobStatus, to: JobStatus): boolean {
  if (from === to) {
    return true;
  }

  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export function toJobDTO(job: Job): JobDTO {
  return {
    id: job.id,
    company: job.company,
    role: job.role,
    location: job.location,
    applicationUrl: job.applicationUrl,
    source: PRISMA_TO_API_JOB_SOURCE[job.source],
    status: PRISMA_TO_API_JOB_STATUS[job.status],
    datePosted: job.datePosted.toISOString(),
    dateDiscovered: job.dateDiscovered.toISOString(),
    resumeChoice: job.resumeChoice,
    resumeRationale: job.resumeRationale,
    formFillStatus: job.formFillStatus ? PRISMA_TO_API_FORM_FILL_STATUS[job.formFillStatus] : null
  };
}

export function parseJobPatchPayload(payload: unknown): ParsedPatchResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "PATCH body must be a JSON object."
    };
  }

  const payloadEntries = Object.entries(payload);

  if (payloadEntries.length === 0) {
    return {
      ok: false,
      error: "PATCH body must include at least one allowed field."
    };
  }

  const updateData: Prisma.JobUpdateInput = {};
  let requestedStatus: JobStatus | null = null;

  for (const [field, value] of payloadEntries) {
    if (!isPatchableField(field)) {
      return {
        ok: false,
        error: `Field "${field}" is not allowed in PATCH payload.`
      };
    }

    if (
      field === "company" ||
      field === "role" ||
      field === "location" ||
      field === "applicationUrl"
    ) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          ok: false,
          error: `Field "${field}" must be a non-empty string.`
        };
      }

      updateData[field] = value.trim();
      continue;
    }

    if (field === "source") {
      if (typeof value !== "string" || !isStringEnumValue(value, JOB_SOURCES)) {
        return {
          ok: false,
          error: `Field "${field}" must be one of: ${JOB_SOURCES.join(", ")}.`
        };
      }

      updateData.source = toPrismaJobSource(value);
      continue;
    }

    if (field === "datePosted") {
      if (typeof value !== "string") {
        return {
          ok: false,
          error: `Field "${field}" must be an ISO date string.`
        };
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return {
          ok: false,
          error: `Field "${field}" must be a valid date string.`
        };
      }

      updateData.datePosted = date;
      continue;
    }

    if (field === "status") {
      if (typeof value !== "string" || !isStringEnumValue(value, JOB_STATUSES)) {
        return {
          ok: false,
          error: `Field "${field}" must be one of: ${JOB_STATUSES.join(", ")}.`
        };
      }

      requestedStatus = value;
      updateData.status = toPrismaJobStatus(value);
      continue;
    }

    if (field === "resumeChoice") {
      if (
        value !== null &&
        (typeof value !== "string" || !isStringEnumValue(value, RESUME_CHOICES))
      ) {
        return {
          ok: false,
          error: `Field "${field}" must be null or one of: ${RESUME_CHOICES.join(", ")}.`
        };
      }

      updateData.resumeChoice = value === null ? null : API_TO_PRISMA_RESUME_CHOICE[value];
      continue;
    }

    if (field === "resumeRationale") {
      if (value !== null && typeof value !== "string") {
        return {
          ok: false,
          error: `Field "${field}" must be a string or null.`
        };
      }

      updateData.resumeRationale = value;
      continue;
    }

    if (field === "formFillStatus") {
      if (
        value !== null &&
        (typeof value !== "string" || !isStringEnumValue(value, FORM_FILL_STATUSES))
      ) {
        return {
          ok: false,
          error: `Field "${field}" must be null or one of: ${FORM_FILL_STATUSES.join(", ")}.`
        };
      }

      updateData.formFillStatus = value === null ? null : toPrismaFormFillStatus(value);
    }
  }

  return {
    ok: true,
    value: {
      data: updateData,
      requestedStatus
    }
  };
}

export const JOB_STATUSES = [
  "new",
  "reviewing",
  "ready",
  "form-filling",
  "form-ready",
  "submitted",
  "accepted",
  "rejected",
  "closed"
] as const;

export const FORM_FILL_STATUSES = [
  "pending",
  "in-progress",
  "completed",
  "failed",
  "awaiting-review"
] as const;

export const RESUME_CHOICES = ["student", "experienced"] as const;
export const JOB_SOURCES = ["new-grad", "internship"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type FormFillStatus = (typeof FORM_FILL_STATUSES)[number];
export type ResumeChoice = (typeof RESUME_CHOICES)[number];
export type JobSource = (typeof JOB_SOURCES)[number];

export interface JobDTO {
  id: string;
  company: string;
  role: string;
  location: string;
  applicationUrl: string;
  source: JobSource;
  status: JobStatus;
  datePosted: string;
  dateDiscovered: string;
  resumeChoice: ResumeChoice | null;
  resumeRationale: string | null;
  formFillStatus: FormFillStatus | null;
}

export interface DashboardStatsDTO {
  total: number;
  pending: number;
  submitted: number;
  accepted: number;
  rejected: number;
}

export interface ResumeRecommendation {
  recommendation: ResumeChoice;
  confidence: number;
  rationale: string;
}

export interface ParsedSWEListJob {
  company: string;
  role: string;
  location: string;
  applicationUrl: string;
  source: JobSource;
  datePosted: Date;
}

export interface SkillContext {
  jobId: string;
  applicationUrl: string;
  userProfilePath: string;
  selectedResumePath: string;
}

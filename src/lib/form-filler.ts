import { mkdir } from "node:fs/promises";
import {
  FormFillRunnerBusyError,
  runFormFillWithTmux,
  type FormFillRunMetadata
} from "@/lib/form-fill-runner";

export interface FormFillResult extends FormFillRunMetadata {
  stoppedAtSubmit: boolean;
  screenshotPaths: string[];
  finalUrl: string;
  manualActionRequired: boolean;
  manualActionReason: string | null;
  orderedReasons: string[];
  skillDeviationReasons: string[];
}

type ParsedFormFillPayload = Omit<FormFillResult, keyof FormFillRunMetadata>;

const ARTIFACTS_DIR = "artifacts";
const FORM_FILL_TIMEOUT_MS = Number(process.env.FORM_FILL_AGENT_TIMEOUT_MS ?? 15 * 60 * 1000);
const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";

function buildFormFillPrompt(applicationUrl: string): string {
  return [
    "Use the repository skill at .agents/skills/job-application-form-filler/SKILL.md.",
    "Load profile data from user-profile.local.md when available, otherwise user-profile.md.",
    "Connect to the user's already-running Chrome via CDP using CDP_ENDPOINT (default http://localhost:9222).",
    "Do not launch a new browser or use headless mode.",
    "Do not close the connected browser, context, or application tab at the end of the run.",
    "Leave the filled application page open for manual review when submit is visible.",
    "Do not run scripts/run-form-fill-agent.sh, do not call /api/form-fill, and do not start tmux from inside this run.",
    "Execute the browser workflow directly in this current Codex session only (no nested Codex runner).",
    "Run the full job application form-fill workflow for this application URL:",
    applicationUrl,
    "Do not modify tracked repository files.",
    "Never click final Submit / Submit Application / Apply.",
    "Stop when submit is visible and collect screenshots from each step in artifacts/.",
    "If blocked by CAPTCHA/login/2FA/network/sandbox, stop and still return JSON.",
    "If you deviate from the skill workflow, record each deviation reason in skillDeviationReasons in chronological order.",
    "Record all blockers/failure causes in orderedReasons in chronological order.",
    "Return ONLY valid JSON. Do not return markdown.",
    "Use this exact shape:",
    '{"stoppedAtSubmit": boolean, "screenshotPaths": string[], "finalUrl": string, "manualActionRequired": boolean, "manualActionReason": string | null, "orderedReasons": string[], "skillDeviationReasons": string[]}',
    'For manualActionReason use short snake_case values such as: "security_verification", "captcha", "login_required", "two_factor_required", "network_blocked", "runner_busy", "unknown".'
  ].join("\n");
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1).trim();
  }

  throw new Error("form-fill runner response did not include JSON output.");
}

function parseFormFillResult(raw: string): ParsedFormFillPayload {
  const payload = JSON.parse(extractJsonPayload(raw)) as Partial<ParsedFormFillPayload>;

  if (typeof payload.stoppedAtSubmit !== "boolean") {
    throw new Error("form-fill result missing boolean stoppedAtSubmit.");
  }

  if (!Array.isArray(payload.screenshotPaths)) {
    throw new Error("form-fill result missing screenshotPaths array.");
  }

  if (!payload.screenshotPaths.every((pathValue) => typeof pathValue === "string")) {
    throw new Error("form-fill result screenshotPaths must contain only strings.");
  }

  if (typeof payload.finalUrl !== "string" || payload.finalUrl.trim().length === 0) {
    throw new Error("form-fill result missing finalUrl.");
  }

  if (typeof payload.manualActionRequired !== "boolean") {
    throw new Error("form-fill result missing boolean manualActionRequired.");
  }

  if (typeof payload.manualActionReason !== "string" && payload.manualActionReason !== null) {
    throw new Error("form-fill result manualActionReason must be string or null.");
  }

  if (!Array.isArray(payload.orderedReasons)) {
    throw new Error("form-fill result missing orderedReasons array.");
  }

  if (!payload.orderedReasons.every((reason) => typeof reason === "string")) {
    throw new Error("form-fill result orderedReasons must contain only strings.");
  }

  if (!Array.isArray(payload.skillDeviationReasons)) {
    throw new Error("form-fill result missing skillDeviationReasons array.");
  }

  if (!payload.skillDeviationReasons.every((reason) => typeof reason === "string")) {
    throw new Error("form-fill result skillDeviationReasons must contain only strings.");
  }

  return {
    stoppedAtSubmit: payload.stoppedAtSubmit,
    screenshotPaths: payload.screenshotPaths,
    finalUrl: payload.finalUrl,
    manualActionRequired: payload.manualActionRequired,
    manualActionReason: payload.manualActionReason,
    orderedReasons: payload.orderedReasons,
    skillDeviationReasons: payload.skillDeviationReasons
  };
}

export async function autoFillApplication(applicationUrl: string): Promise<FormFillResult> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const cdpEndpoint = process.env.CDP_ENDPOINT?.trim() || DEFAULT_CDP_ENDPOINT;

  const prompt = buildFormFillPrompt(applicationUrl);
  const run = await runFormFillWithTmux({
    prompt,
    cdpEndpoint,
    timeoutMs: FORM_FILL_TIMEOUT_MS
  });

  const parsed = parseFormFillResult(run.rawOutput);
  return {
    ...parsed,
    runId: run.runId,
    runDir: run.runDir,
    agentLogPath: run.agentLogPath,
    rawOutputPath: run.rawOutputPath
  };
}

export { FormFillRunnerBusyError };

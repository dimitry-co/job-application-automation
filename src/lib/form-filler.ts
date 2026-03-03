import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface FormFillResult {
  stoppedAtSubmit: boolean;
  screenshotPaths: string[];
  finalUrl: string;
  manualActionRequired: boolean;
  manualActionReason: string | null;
  orderedReasons: string[];
  skillDeviationReasons: string[];
}

const ARTIFACTS_DIR = "artifacts";
const CODEX_OUTPUT_FILE = "codex-last-message.txt";
const CODEX_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FORM_FILL_TIMEOUT_MS = Number(process.env.FORM_FILL_AGENT_TIMEOUT_MS ?? 15 * 60 * 1000);
const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";

type ExecResult = {
  stdout: string;
  stderr: string;
};

type ExecErrorWithOutput = Error & {
  code?: string | number;
  stdout?: string;
  stderr?: string;
};

function runExecFile(command: string, args: string[], cdpEndpoint: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        timeout: FORM_FILL_TIMEOUT_MS,
        maxBuffer: CODEX_MAX_BUFFER_BYTES,
        env: {
          ...process.env,
          CDP_ENDPOINT: cdpEndpoint
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          const execError = error as ExecErrorWithOutput;
          const reason = [
            `codex exec failed`,
            typeof execError.code !== "undefined" ? `code=${String(execError.code)}` : null,
            execError.message ? `message=${execError.message}` : null
          ]
            .filter(Boolean)
            .join(", ");
          reject(new Error(reason));
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

function buildFormFillPrompt(applicationUrl: string): string {
  return [
    "Use the repository skill at .agents/skills/job-application-form-filler/SKILL.md.",
    "Load profile data from user-profile.local.md when available, otherwise user-profile.md.",
    "Connect to the user's already-running Chrome via CDP using CDP_ENDPOINT (default http://localhost:9222).",
    "Do not launch a new browser or use headless mode.",
    "Run the full job application form-fill workflow for this application URL:",
    applicationUrl,
    "Do not modify tracked repository files.",
    "Never click final Submit / Submit Application / Apply.",
    "Stop when submit is visible and collect screenshots from each step in artifacts/.",
    "If blocked by CAPTCHA/login/2FA/network/sandbox, stop and still return JSON.",
    "If you deviate from the skill workflow, record each deviation reason in skillDeviationReasons in chronological order.",
    "Record all blockers/failure causes in orderedReasons in chronological order.",
    "Return ONLY valid JSON with this exact shape:",
    '{"stoppedAtSubmit": boolean, "screenshotPaths": string[], "finalUrl": string, "manualActionRequired": boolean, "manualActionReason": string | null, "orderedReasons": string[], "skillDeviationReasons": string[]}',
    'For manualActionReason use short snake_case values such as: "security_verification", "captcha", "login_required", "two_factor_required", "network_blocked", "unknown".'
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

  throw new Error("codex exec response did not include JSON output.");
}

function parseFormFillResult(raw: string): FormFillResult {
  const payload = JSON.parse(extractJsonPayload(raw)) as Partial<FormFillResult>;

  if (typeof payload.stoppedAtSubmit !== "boolean") {
    throw new Error("codex exec result missing boolean stoppedAtSubmit.");
  }

  if (!Array.isArray(payload.screenshotPaths)) {
    throw new Error("codex exec result missing screenshotPaths array.");
  }

  if (!payload.screenshotPaths.every((pathValue) => typeof pathValue === "string")) {
    throw new Error("codex exec result screenshotPaths must contain only strings.");
  }

  if (typeof payload.finalUrl !== "string" || payload.finalUrl.trim().length === 0) {
    throw new Error("codex exec result missing finalUrl.");
  }

  if (typeof payload.manualActionRequired !== "boolean") {
    throw new Error("codex exec result missing boolean manualActionRequired.");
  }

  if (typeof payload.manualActionReason !== "string" && payload.manualActionReason !== null) {
    throw new Error("codex exec result manualActionReason must be string or null.");
  }

  if (!Array.isArray(payload.orderedReasons)) {
    throw new Error("codex exec result missing orderedReasons array.");
  }

  if (!payload.orderedReasons.every((reason) => typeof reason === "string")) {
    throw new Error("codex exec result orderedReasons must contain only strings.");
  }

  if (!Array.isArray(payload.skillDeviationReasons)) {
    throw new Error("codex exec result missing skillDeviationReasons array.");
  }

  if (!payload.skillDeviationReasons.every((reason) => typeof reason === "string")) {
    throw new Error("codex exec result skillDeviationReasons must contain only strings.");
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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-form-fill-"));
  const outputPath = path.join(tempDir, CODEX_OUTPUT_FILE);
  const cdpEndpoint = process.env.CDP_ENDPOINT?.trim() || DEFAULT_CDP_ENDPOINT;

  try {
    const prompt = buildFormFillPrompt(applicationUrl);
    await runExecFile(
      "codex",
      [
        "exec",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "--cd",
        process.cwd(),
        "--output-last-message",
        outputPath,
        prompt
      ],
      cdpEndpoint
    );

    const lastMessage = await readFile(outputPath, "utf8");
    return parseFormFillResult(lastMessage);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

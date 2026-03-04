import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FormFillRunnerInput {
  prompt: string;
  cdpEndpoint: string;
  timeoutMs: number;
}

export interface FormFillRunMetadata {
  runId: string;
  runDir: string;
  agentLogPath: string;
  rawOutputPath: string;
}

export interface FormFillRunnerOutput extends FormFillRunMetadata {
  rawOutput: string;
}

const RUNS_ROOT_DIR = path.join("artifacts", "form-fill-runs");
const DEFAULT_LOCK_PATH = "/tmp/job-app-form-fill.lock";
const DEFAULT_POLL_MS = 250;
const TMUX_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

type ExecErrorWithCode = Error & { code?: string | number };

export class FormFillRunnerBusyError extends Error {
  constructor(
    message = "Form-fill runner is already active. Retry once the current run finishes."
  ) {
    super(message);
    this.name = "FormFillRunnerBusyError";
  }
}

function getRunnerLockPath(): string {
  const configured = process.env.FORM_FILL_RUNNER_LOCK_PATH?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_LOCK_PATH;
}

function getPollIntervalMs(): number {
  const configured = Number(process.env.FORM_FILL_RUNNER_POLL_MS ?? DEFAULT_POLL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_POLL_MS;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return (error as { code?: string }).code === "ENOENT";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function runTmux(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "tmux",
      args,
      {
        cwd: process.cwd(),
        maxBuffer: TMUX_MAX_BUFFER_BYTES
      },
      (error) => {
        if (error) {
          const tmuxError = error as ExecErrorWithCode;
          reject(
            new Error(
              `tmux command failed: tmux ${args.join(" ")} (code=${String(
                tmuxError.code ?? "unknown"
              )})`
            )
          );
          return;
        }

        resolve();
      }
    );
  });
}

async function killTmuxSession(sessionName: string): Promise<void> {
  try {
    await runTmux(["kill-session", "-t", sessionName]);
  } catch {
    // Session may have already exited naturally.
  }
}

export async function runFormFillWithTmux(
  input: FormFillRunnerInput
): Promise<FormFillRunnerOutput> {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.resolve(process.cwd(), RUNS_ROOT_DIR, runId);
  const agentLogPath = path.join(runDir, "pane.log");
  const promptPath = path.join(runDir, "prompt.txt");
  const rawOutputPath = path.join(runDir, "last-message.txt");
  const doneOkPath = path.join(runDir, "done.ok");
  const doneErrorPath = path.join(runDir, "done.error");
  const scriptPath = path.resolve(process.cwd(), "scripts", "run-form-fill-agent.sh");
  const sessionName = `formfill-${runId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const lockPath = getRunnerLockPath();
  const pollMs = getPollIntervalMs();

  await mkdir(runDir, { recursive: true });
  await writeFile(promptPath, input.prompt, "utf8");

  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    try {
      lockHandle = await open(lockPath, "wx");
      await lockHandle.writeFile(`${runId}\n`);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error)) {
        throw error;
      }

      if ((error as { code?: string }).code === "EEXIST") {
        throw new FormFillRunnerBusyError();
      }

      throw error;
    }

    const command = [
      "bash",
      shellEscape(scriptPath),
      shellEscape(promptPath),
      shellEscape(rawOutputPath),
      shellEscape(doneOkPath),
      shellEscape(doneErrorPath),
      shellEscape(input.cdpEndpoint),
      shellEscape(process.cwd())
    ].join(" ");

    await runTmux(["new-session", "-d", "-s", sessionName, "-c", process.cwd(), command]);
    await runTmux(["pipe-pane", "-t", sessionName, "-o", `cat >> ${shellEscape(agentLogPath)}`]);

    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() <= deadline) {
      if (await fileExists(doneErrorPath)) {
        const reason = (await readFile(doneErrorPath, "utf8")).trim();
        throw new Error(
          reason.length > 0 ? reason : "form-fill agent exited with an unknown error"
        );
      }

      if (await fileExists(doneOkPath)) {
        const rawOutput = await readFile(rawOutputPath, "utf8");
        if (rawOutput.trim().length === 0) {
          throw new Error("form-fill agent completed without producing output");
        }

        return {
          runId,
          runDir,
          agentLogPath,
          rawOutputPath,
          rawOutput
        };
      }

      await sleep(pollMs);
    }

    throw new Error(`form-fill agent timed out after ${input.timeoutMs}ms`);
  } finally {
    await killTmuxSession(sessionName);

    if (lockHandle) {
      await lockHandle.close();
      await unlink(lockPath).catch(() => {
        // Lock may already be removed if the process terminated unexpectedly.
      });
    }
  }
}

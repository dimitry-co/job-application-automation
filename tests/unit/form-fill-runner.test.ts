import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

import { FormFillRunnerBusyError, runFormFillWithTmux } from "@/lib/form-fill-runner";

function extractSingleQuotedArgs(command: string): string[] {
  const matches = command.match(/'([^']+)'/g) ?? [];
  return matches.map((value) => value.slice(1, -1));
}

describe("runFormFillWithTmux", () => {
  const originalLockPath = process.env.FORM_FILL_RUNNER_LOCK_PATH;
  const originalPollMs = process.env.FORM_FILL_RUNNER_POLL_MS;
  let lockPath = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    lockPath = path.join("/tmp", `form-fill-runner-lock-${Date.now()}-${Math.random()}.lock`);
    process.env.FORM_FILL_RUNNER_LOCK_PATH = lockPath;
    process.env.FORM_FILL_RUNNER_POLL_MS = "5";

    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: Record<string, unknown>,
        callback: ExecCallback
      ) => {
        callback(null, "", "");

        if (args[0] === "new-session") {
          const shellCommand = args[args.length - 1];
          const quotedArgs = extractSingleQuotedArgs(shellCommand);
          const rawOutputPath = quotedArgs[2];
          const doneOkPath = quotedArgs[3];

          if (rawOutputPath && doneOkPath) {
            setTimeout(() => {
              void writeFile(
                rawOutputPath,
                JSON.stringify({
                  stoppedAtSubmit: true,
                  screenshotPaths: [],
                  finalUrl: "https://jobs.example.com/submit",
                  manualActionRequired: false,
                  manualActionReason: null,
                  orderedReasons: [],
                  skillDeviationReasons: []
                }),
                "utf8"
              );
              void writeFile(doneOkPath, "ok\n", "utf8");
            }, 10);
          }
        }

        return {} as never;
      }
    );
  });

  afterEach(async () => {
    if (typeof originalLockPath === "undefined") {
      delete process.env.FORM_FILL_RUNNER_LOCK_PATH;
    } else {
      process.env.FORM_FILL_RUNNER_LOCK_PATH = originalLockPath;
    }

    if (typeof originalPollMs === "undefined") {
      delete process.env.FORM_FILL_RUNNER_POLL_MS;
    } else {
      process.env.FORM_FILL_RUNNER_POLL_MS = originalPollMs;
    }

    await rm(path.resolve(process.cwd(), "artifacts", "form-fill-runs"), {
      recursive: true,
      force: true
    });
    await rm(lockPath, { force: true });
  });

  test("starts tmux runner, captures pane log command, and returns raw output metadata", async () => {
    const result = await runFormFillWithTmux({
      prompt: "Fill form for https://jobs.example.com/opening",
      cdpEndpoint: "http://localhost:9222",
      timeoutMs: 500
    });

    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.runDir).toContain(path.join("artifacts", "form-fill-runs"));
    expect(result.agentLogPath.endsWith("pane.log")).toBe(true);
    expect(result.rawOutputPath.endsWith("last-message.txt")).toBe(true);
    expect(result.rawOutput).toContain('"stoppedAtSubmit":true');

    expect(execFileMock).toHaveBeenCalled();
    const tmuxCalls = execFileMock.mock.calls.map((call) => call[1] as string[]);
    expect(tmuxCalls.some((args) => args[0] === "new-session")).toBe(true);
    expect(tmuxCalls.some((args) => args[0] === "pipe-pane")).toBe(true);
    expect(tmuxCalls.some((args) => args[0] === "kill-session")).toBe(true);
  });

  test("throws busy error when lock is already held", async () => {
    await writeFile(lockPath, "locked\n", "utf8");

    await expect(
      runFormFillWithTmux({
        prompt: "Fill form",
        cdpEndpoint: "http://localhost:9222",
        timeoutMs: 100
      })
    ).rejects.toBeInstanceOf(FormFillRunnerBusyError);
  });
});

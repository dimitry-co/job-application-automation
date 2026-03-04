import { beforeEach, describe, expect, test, vi } from "vitest";

const { mkdirMock, runFormFillWithTmuxMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  runFormFillWithTmuxMock: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock
}));

vi.mock("@/lib/form-fill-runner", () => ({
  runFormFillWithTmux: runFormFillWithTmuxMock,
  FormFillRunnerBusyError: class FormFillRunnerBusyError extends Error {}
}));

import { autoFillApplication } from "@/lib/form-filler";

describe("autoFillApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    runFormFillWithTmuxMock.mockResolvedValue({
      runId: "run-1",
      runDir: "/tmp/run-1",
      agentLogPath: "/tmp/run-1/pane.log",
      rawOutputPath: "/tmp/run-1/last-message.txt",
      rawOutput: JSON.stringify({
        stoppedAtSubmit: true,
        screenshotPaths: ["artifacts/step-1.png", "artifacts/step-2.png"],
        finalUrl: "https://jobs.example.com/apply#submit",
        manualActionRequired: false,
        manualActionReason: null,
        orderedReasons: [],
        skillDeviationReasons: []
      })
    });
  });

  test("runs tmux form-fill runner and returns parsed JSON result with run metadata", async () => {
    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(mkdirMock).toHaveBeenCalledWith("artifacts", { recursive: true });
    expect(runFormFillWithTmuxMock).toHaveBeenCalledTimes(1);
    const [input] = runFormFillWithTmuxMock.mock.calls[0] as [
      { prompt: string; cdpEndpoint: string; timeoutMs: number }
    ];
    expect(input.cdpEndpoint).toBe("http://localhost:9222");
    expect(input.prompt).toContain("https://jobs.example.com/opening");
    expect(input.prompt).toContain("Return ONLY valid JSON. Do not return markdown.");
    expect(input.prompt).toContain(
      "All browser interactions must use the CLI tool at scripts/form-fill-cli.ts."
    );
    expect(input.prompt).toContain("Do not use raw Playwright actions");
    expect(input.prompt).toContain("do not start tmux from inside this run");

    expect(result).toEqual({
      stoppedAtSubmit: true,
      screenshotPaths: ["artifacts/step-1.png", "artifacts/step-2.png"],
      finalUrl: "https://jobs.example.com/apply#submit",
      manualActionRequired: false,
      manualActionReason: null,
      orderedReasons: [],
      skillDeviationReasons: [],
      runId: "run-1",
      runDir: "/tmp/run-1",
      agentLogPath: "/tmp/run-1/pane.log",
      rawOutputPath: "/tmp/run-1/last-message.txt"
    });
  });

  test("accepts JSON wrapped in markdown code fences", async () => {
    runFormFillWithTmuxMock.mockResolvedValue({
      runId: "run-2",
      runDir: "/tmp/run-2",
      agentLogPath: "/tmp/run-2/pane.log",
      rawOutputPath: "/tmp/run-2/last-message.txt",
      rawOutput: [
        "Result:",
        "```json",
        '{"stoppedAtSubmit":false,"screenshotPaths":["artifacts/step.png"],"finalUrl":"https://jobs.example.com/apply","manualActionRequired":true,"manualActionReason":"security_verification","orderedReasons":["security_verification_page","form_not_reached"],"skillDeviationReasons":["inline_script_used_for_fallback"]}',
        "```"
      ].join("\n")
    });

    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(result).toEqual({
      stoppedAtSubmit: false,
      screenshotPaths: ["artifacts/step.png"],
      finalUrl: "https://jobs.example.com/apply",
      manualActionRequired: true,
      manualActionReason: "security_verification",
      orderedReasons: ["security_verification_page", "form_not_reached"],
      skillDeviationReasons: ["inline_script_used_for_fallback"],
      runId: "run-2",
      runDir: "/tmp/run-2",
      agentLogPath: "/tmp/run-2/pane.log",
      rawOutputPath: "/tmp/run-2/last-message.txt"
    });
  });

  test("passes configured CDP endpoint to runner", async () => {
    const originalCdpEndpoint = process.env.CDP_ENDPOINT;
    process.env.CDP_ENDPOINT = "http://localhost:9333";

    try {
      await autoFillApplication("https://jobs.example.com/opening");
    } finally {
      if (typeof originalCdpEndpoint === "undefined") {
        delete process.env.CDP_ENDPOINT;
      } else {
        process.env.CDP_ENDPOINT = originalCdpEndpoint;
      }
    }

    const [input] = runFormFillWithTmuxMock.mock.calls[0] as [
      { prompt: string; cdpEndpoint: string; timeoutMs: number }
    ];
    expect(input.cdpEndpoint).toBe("http://localhost:9333");
  });

  test("throws when runner output is missing JSON payload", async () => {
    runFormFillWithTmuxMock.mockResolvedValue({
      runId: "run-3",
      runDir: "/tmp/run-3",
      agentLogPath: "/tmp/run-3/pane.log",
      rawOutputPath: "/tmp/run-3/last-message.txt",
      rawOutput: "No structured output"
    });

    await expect(autoFillApplication("https://jobs.example.com/opening")).rejects.toThrow(
      "did not include JSON output"
    );
  });
});

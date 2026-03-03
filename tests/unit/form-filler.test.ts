import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const { execFileMock, mkdirMock, mkdtempMock, readFileMock, rmMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  rm: rmMock
}));

import { autoFillApplication } from "@/lib/form-filler";

describe("autoFillApplication", () => {
  const originalCdpEndpoint = process.env.CDP_ENDPOINT;

  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof originalCdpEndpoint === "undefined") {
      delete process.env.CDP_ENDPOINT;
    } else {
      process.env.CDP_ENDPOINT = originalCdpEndpoint;
    }
    mkdirMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue("/tmp/codex-form-fill-test");
    readFileMock.mockResolvedValue(
      JSON.stringify({
        stoppedAtSubmit: true,
        screenshotPaths: ["artifacts/step-1.png", "artifacts/step-2.png"],
        finalUrl: "https://jobs.example.com/apply#submit",
        manualActionRequired: false,
        manualActionReason: null,
        orderedReasons: [],
        skillDeviationReasons: []
      })
    );
    rmMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ExecCallback
      ) => {
        callback(null, "", "");
        return {} as never;
      }
    );
  });

  afterEach(() => {
    if (typeof originalCdpEndpoint === "undefined") {
      delete process.env.CDP_ENDPOINT;
    } else {
      process.env.CDP_ENDPOINT = originalCdpEndpoint;
    }
    vi.restoreAllMocks();
  });

  test("runs codex exec and returns parsed JSON result", async () => {
    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(mkdirMock).toHaveBeenCalledWith("artifacts", { recursive: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);

    const [, args, options] = execFileMock.mock.calls[0] as [
      string,
      string[],
      { env?: Record<string, string | undefined> }
    ];
    expect(args).toContain("exec");
    expect(args).toContain("--output-last-message");
    expect(args[args.length - 1]).toContain("https://jobs.example.com/opening");
    expect(args[args.length - 1]).toContain("Connect to the user's already-running Chrome via CDP");
    expect(args[args.length - 1]).toContain("Do not launch a new browser or use headless mode.");
    expect(options.env?.CDP_ENDPOINT).toBe("http://localhost:9222");

    expect(readFileMock).toHaveBeenCalledWith(
      "/tmp/codex-form-fill-test/codex-last-message.txt",
      "utf8"
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/codex-form-fill-test", {
      recursive: true,
      force: true
    });
    expect(result).toEqual({
      stoppedAtSubmit: true,
      screenshotPaths: ["artifacts/step-1.png", "artifacts/step-2.png"],
      finalUrl: "https://jobs.example.com/apply#submit",
      manualActionRequired: false,
      manualActionReason: null,
      orderedReasons: [],
      skillDeviationReasons: []
    });
  });

  test("accepts JSON wrapped in markdown code fences", async () => {
    readFileMock.mockResolvedValue(
      [
        "Result:",
        "```json",
        '{"stoppedAtSubmit":false,"screenshotPaths":["artifacts/step.png"],"finalUrl":"https://jobs.example.com/apply","manualActionRequired":true,"manualActionReason":"security_verification","orderedReasons":["security_verification_page","form_not_reached"],"skillDeviationReasons":["inline_script_used_for_fallback"]}',
        "```"
      ].join("\n")
    );

    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(result).toEqual({
      stoppedAtSubmit: false,
      screenshotPaths: ["artifacts/step.png"],
      finalUrl: "https://jobs.example.com/apply",
      manualActionRequired: true,
      manualActionReason: "security_verification",
      orderedReasons: ["security_verification_page", "form_not_reached"],
      skillDeviationReasons: ["inline_script_used_for_fallback"]
    });
  });

  test("passes configured CDP endpoint to codex exec env", async () => {
    process.env.CDP_ENDPOINT = "http://localhost:9333";

    await autoFillApplication("https://jobs.example.com/opening");

    const [, , options] = execFileMock.mock.calls[0] as [
      string,
      string[],
      { env?: Record<string, string | undefined> }
    ];
    expect(options.env?.CDP_ENDPOINT).toBe("http://localhost:9333");
  });

  test("cleans temp directory and throws when codex exec fails", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ExecCallback
      ) => {
        callback(new Error("spawn codex ENOENT"), "", "");
        return {} as never;
      }
    );

    await expect(autoFillApplication("https://jobs.example.com/opening")).rejects.toThrow(
      "codex exec failed"
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/codex-form-fill-test", {
      recursive: true,
      force: true
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });
});

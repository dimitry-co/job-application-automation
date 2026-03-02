import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { closeMock, countMock, gotoMock, launchMock, newPageMock, screenshotMock, urlMock } =
  vi.hoisted(() => {
    const goto = vi.fn();
    const count = vi.fn();
    const screenshot = vi.fn();
    const url = vi.fn();
    const close = vi.fn();
    const newPage = vi.fn(async () => ({
      goto,
      locator: vi.fn(() => ({
        count
      })),
      screenshot,
      url
    }));
    const launch = vi.fn(async () => ({
      newPage,
      close
    }));

    return {
      closeMock: close,
      countMock: count,
      gotoMock: goto,
      launchMock: launch,
      newPageMock: newPage,
      screenshotMock: screenshot,
      urlMock: url
    };
  });

vi.mock("playwright", () => ({
  chromium: {
    launch: launchMock
  }
}));

import { autoFillApplication } from "@/lib/form-filler";

describe("autoFillApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gotoMock.mockResolvedValue(undefined);
    countMock.mockResolvedValue(1);
    screenshotMock.mockResolvedValue(undefined);
    urlMock.mockReturnValue("https://jobs.example.com/apply");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("captures screenshot and reports submit stopping point", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_717_171_717_000);

    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(launchMock).toHaveBeenCalledWith({ headless: false });
    expect(newPageMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith("https://jobs.example.com/opening", {
      waitUntil: "domcontentloaded"
    });
    expect(screenshotMock).toHaveBeenCalledWith({
      path: "artifacts/form-fill-1717171717000.png",
      fullPage: true
    });
    expect(result).toEqual({
      stoppedAtSubmit: true,
      screenshotPaths: ["artifacts/form-fill-1717171717000.png"],
      finalUrl: "https://jobs.example.com/apply"
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
    dateNowSpy.mockRestore();
  });

  test("keeps submit safety signal false when no submit button is visible", async () => {
    countMock.mockResolvedValue(0);

    const result = await autoFillApplication("https://jobs.example.com/opening");

    expect(result.stoppedAtSubmit).toBe(false);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test("always closes browser when navigation fails", async () => {
    gotoMock.mockRejectedValue(new Error("Navigation timeout"));

    await expect(autoFillApplication("https://jobs.example.com/opening")).rejects.toThrow(
      "Navigation timeout"
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

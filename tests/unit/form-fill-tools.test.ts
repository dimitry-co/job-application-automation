import { describe, expect, test, vi } from "vitest";

const { connectOverCDPMock } = vi.hoisted(() => ({
  connectOverCDPMock: vi.fn()
}));

vi.mock("@playwright/test", () => ({
  chromium: {
    connectOverCDP: connectOverCDPMock
  }
}));

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import {
  connectChrome,
  detectBlockers,
  fillField,
  getPageSnapshot,
  scrollPage
} from "@/lib/form-fill-tools";

function makeLocator(overrides: Partial<Locator>): Locator {
  return {
    count: vi.fn(async () => 0),
    isVisible: vi.fn(async () => false),
    click: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => []),
    evaluate: vi.fn(async () => ""),
    first: vi.fn(function first(this: Locator) {
      return this;
    }),
    ...overrides
  } as unknown as Locator;
}

function makePageForScore(urlValue: string, titleValue: string, fieldCount: number): Page {
  return {
    url: vi.fn(() => urlValue),
    title: vi.fn(async () => titleValue),
    locator: vi.fn(() =>
      makeLocator({
        count: vi.fn(async () => fieldCount)
      })
    ),
    bringToFront: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined)
  } as unknown as Page;
}

describe("form-fill-tools", () => {
  test("connectChrome selects best non-chrome application tab", async () => {
    const chromePage = makePageForScore("chrome://newtab", "New Tab", 0);
    const simplifyPage = makePageForScore("https://simplify.jobs/job/abc", "Simplify", 12);
    const greenhousePage = makePageForScore(
      "https://boards.greenhouse.io/acme/jobs/123",
      "Software Engineer Application",
      20
    );

    const context = {
      pages: vi.fn(() => [chromePage, simplifyPage, greenhousePage]),
      newPage: vi.fn(async () => greenhousePage)
    } as unknown as BrowserContext;

    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn(async () => context)
    } as unknown as Browser;

    connectOverCDPMock.mockResolvedValue(browser);

    const connection = await connectChrome("http://localhost:9222");

    expect(connectOverCDPMock).toHaveBeenCalledWith("http://localhost:9222", {
      timeout: 15000
    });
    expect(connection.page).toBe(greenhousePage);
    expect(greenhousePage.bringToFront).toHaveBeenCalledTimes(1);
  });

  test("getPageSnapshot returns structured fields and submit signal", async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce([
          {
            label: "Name",
            type: "text",
            tagName: "input",
            value: "",
            required: true,
            visible: true,
            selectorHint: "#name"
          }
        ])
        .mockResolvedValueOnce("Visible page text")
        .mockResolvedValueOnce(true),
      title: vi.fn(async () => "Apply Now"),
      url: vi.fn(() => "https://jobs.example.com/apply")
    } as unknown as Page;

    const snapshot = await getPageSnapshot(page);

    expect(snapshot).toEqual({
      url: "https://jobs.example.com/apply",
      title: "Apply Now",
      fields: [
        {
          label: "Name",
          type: "text",
          tagName: "input",
          value: "",
          required: true,
          visible: true,
          selectorHint: "#name"
        }
      ],
      visibleText: "Visible page text",
      hasSubmitButton: true
    });
  });

  test("fillField fills by label before fallbacks", async () => {
    const labelLocator = makeLocator({
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      evaluate: vi.fn().mockResolvedValueOnce("input").mockResolvedValueOnce("Jane Doe")
    });

    const page = {
      getByLabel: vi.fn(() => ({
        first: vi.fn(() => labelLocator)
      })),
      locator: vi.fn(() => makeLocator({ count: vi.fn(async () => 0) }))
    } as unknown as Page;

    const result = await fillField(page, "Name", "Jane Doe");

    expect(result).toEqual({
      success: true,
      fieldFound: true,
      actualValue: "Jane Doe"
    });
    expect(page.getByLabel).toHaveBeenCalledTimes(1);
  });

  test("detectBlockers identifies login wall", async () => {
    const hiddenLocator = makeLocator({
      count: vi.fn(async () => 0),
      isVisible: vi.fn(async () => false),
      first: vi.fn(function first(this: Locator) {
        return this as unknown as Locator;
      })
    });

    const bodyLocator = makeLocator({
      innerText: vi.fn(async () => "Please sign in to continue")
    } as unknown as Partial<Locator>);

    const passwordLocator = makeLocator({
      count: vi.fn(async () => 1)
    });

    const page = {
      getByText: vi.fn(() => ({
        first: vi.fn(() => hiddenLocator)
      })),
      locator: vi.fn((selector: string) => {
        if (selector === "body") {
          return bodyLocator;
        }

        if (selector === "input[type='password']") {
          return passwordLocator;
        }

        if (selector === "input, textarea, select") {
          return makeLocator({ count: vi.fn(async () => 5) });
        }

        return hiddenLocator;
      })
    } as unknown as Page;

    const result = await detectBlockers(page);

    expect(result).toEqual({
      blocked: true,
      reason: "login_required"
    });
  });

  test("scrollPage returns scroll metadata", async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        previousY: 0,
        scrollY: 640,
        pageHeight: 2000
      }))
    } as unknown as Page;

    const result = await scrollPage(page, "down");

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      scrollY: 640,
      pageHeight: 2000
    });
  });
});

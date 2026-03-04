import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page
} from "@playwright/test";

export type FillableField = "input" | "textarea" | "select";

export interface SnapshotField {
  label: string;
  type: string;
  tagName: string;
  value: string;
  required: boolean;
  visible: boolean;
  selectorHint: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  fields: SnapshotField[];
  visibleText: string;
  hasSubmitButton: boolean;
}

export interface FillFieldResult {
  success: boolean;
  fieldFound: boolean;
  actualValue: string;
}

export interface FillDropdownResult {
  success: boolean;
  selectedOption: string | null;
}

export interface FillTextareaResult {
  success: boolean;
}

export interface UploadResumeResult {
  success: boolean;
}

export interface ClickButtonResult {
  clicked: boolean;
  text: string | null;
}

export interface ScreenshotResult {
  success: boolean;
  path: string;
}

export interface DismissOverlaysResult {
  dismissed: string[];
}

export type BlockerReason =
  | "security_verification"
  | "captcha"
  | "login_required"
  | "two_factor_required"
  | "network_blocked";

export interface BlockerDetectionResult {
  blocked: boolean;
  reason: BlockerReason;
}

export interface ScrollPageResult {
  scrollY: number;
  pageHeight: number;
}

export interface ConnectedChrome {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

type PageChoice = {
  page: Page;
  score: number;
};

const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) {
    return pattern;
  }

  return new RegExp(escapeRegExp(pattern.trim()), "i");
}

function makeCssAttributeContainsSelector(attribute: string, value: string): string {
  const escaped = value.replace(/"/g, '\\"');
  return `[${attribute}*="${escaped}" i]`;
}

async function safeVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function clickLocatorWithFallback(locator: Locator, timeoutMs: number): Promise<boolean> {
  if ((await locator.count()) === 0 || !(await safeVisible(locator))) {
    return false;
  }

  try {
    await locator.click({ timeout: timeoutMs });
    return true;
  } catch {
    // Continue through fallbacks.
  }

  try {
    await locator.click({ timeout: timeoutMs, force: true });
    return true;
  } catch {
    // Continue through fallbacks.
  }

  try {
    return await locator.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
        return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

async function clickByTextViaDom(page: Page, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const pattern = `^\\s*${escapeRegExp(trimmed)}\\s*$`;

  try {
    return await page.evaluate((source) => {
      const matcher = new RegExp(source, "i");
      const candidates = Array.from(
        document.querySelectorAll("button, a, [role='button'], [role='link']")
      );
      for (const candidate of candidates) {
        const node = candidate as HTMLElement;
        const label = (node.innerText || node.textContent || "").trim();
        if (matcher.test(label)) {
          node.click();
          return true;
        }
      }
      return false;
    }, pattern);
  } catch {
    return false;
  }
}

async function clickIfVisible(page: Page, patterns: string[]): Promise<string | null> {
  for (const pattern of patterns) {
    const exactRegex = new RegExp(`^\\s*${escapeRegExp(pattern)}\\s*$`, "i");
    const partialRegex = new RegExp(escapeRegExp(pattern), "i");

    const button = page.getByRole("button", { name: exactRegex }).first();
    if (await clickLocatorWithFallback(button, 2500)) {
      return pattern;
    }

    const link = page.getByRole("link", { name: exactRegex }).first();
    if (await clickLocatorWithFallback(link, 2500)) {
      return pattern;
    }

    const roleButton = page.locator("[role='button']").filter({ hasText: exactRegex }).first();
    if (await clickLocatorWithFallback(roleButton, 2500)) {
      return pattern;
    }

    const text = page.getByText(partialRegex).first();
    if (await clickLocatorWithFallback(text, 2500)) {
      return pattern;
    }

    if (await clickByTextViaDom(page, pattern)) {
      return pattern;
    }
  }

  return null;
}

async function scorePageForFormFill(page: Page): Promise<number> {
  const url = page.url();
  if (url.length === 0 || url.startsWith("chrome://")) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (!url.includes("simplify.jobs")) {
    score += 300;
  }

  const host = (() => {
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (host.endsWith("greenhouse.io") || host.endsWith("lever.co") || host.endsWith("ashbyhq.com")) {
    score += 120;
  }

  const title = (await page.title().catch(() => "")).toLowerCase();
  if (title.includes("application") || title.includes("apply")) {
    score += 50;
  }

  const formFields = await page
    .locator("input, select, textarea, [role='combobox']")
    .count()
    .catch(() => 0);

  score += Math.min(formFields, 80);
  return score;
}

async function selectBestApplicationPage(context: BrowserContext): Promise<Page | null> {
  const candidates = context.pages();
  if (candidates.length === 0) {
    return null;
  }

  const scored: PageChoice[] = [];

  for (const candidate of candidates) {
    const score = await scorePageForFormFill(candidate);
    if (Number.isFinite(score)) {
      scored.push({ page: candidate, score });
    }
  }

  const best = scored.sort((left, right) => right.score - left.score)[0] ?? null;
  if (!best || best.score < 0) {
    return null;
  }

  return best.page;
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

async function getLocatorCurrentValue(locator: Locator): Promise<string> {
  return locator
    .evaluate((node) => {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        return node.value;
      }
      if (node instanceof HTMLSelectElement) {
        if (node.selectedIndex >= 0) {
          const selected = node.options[node.selectedIndex];
          return selected ? selected.text : "";
        }
      }
      return "";
    })
    .catch(() => "");
}

async function fillLocator(locator: Locator, value: string): Promise<string | null> {
  const count = await locator.count().catch(() => 0);
  if (count === 0 || !(await safeVisible(locator))) {
    return null;
  }

  const tag = (await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => "")) || "";

  if (tag === "select") {
    try {
      await locator.selectOption({ label: value });
      return await getLocatorCurrentValue(locator);
    } catch {
      try {
        await locator.selectOption({ value });
        return await getLocatorCurrentValue(locator);
      } catch {
        return "";
      }
    }
  }

  try {
    await locator.click({ timeout: 2000 });
    await locator
      .press(process.platform === "darwin" ? "Meta+A" : "Control+A")
      .catch(() => undefined);
    await locator.fill(value, { timeout: 3000 });
    await locator.press("Tab").catch(() => undefined);
    return await getLocatorCurrentValue(locator);
  } catch {
    return "";
  }
}

async function listLikelyFieldSelectors(page: Page, pattern: RegExp): Promise<string[]> {
  const result = await page
    .evaluate(
      ({ source, flags }) => {
        const matcher = new RegExp(source, flags.includes("i") ? flags : `${flags}i`);

        const selectorFromNode = (node: Element): string => {
          const id = node.getAttribute("id") || "";
          if (id.length > 0) {
            return `#${id.replace(/([.#:[\],])/g, "\\$1")}`;
          }

          const name = node.getAttribute("name") || "";
          if (name.length > 0) {
            const safeName = name.replace(/"/g, '\\"');
            return `${node.tagName.toLowerCase()}[name=\"${safeName}\"]`;
          }

          const placeholder = node.getAttribute("placeholder") || "";
          if (placeholder.length > 0) {
            const safePlaceholder = placeholder.replace(/"/g, '\\"');
            return `${node.tagName.toLowerCase()}[placeholder=\"${safePlaceholder}\"]`;
          }

          return node.tagName.toLowerCase();
        };

        const seen = new Set<string>();
        const selectors: string[] = [];
        const fields = Array.from(document.querySelectorAll("input, textarea, select"));

        for (const field of fields) {
          const labelText = Array.from((field as HTMLInputElement).labels || [])
            .map((label) => (label.textContent || "").trim())
            .join(" ");
          const name = field.getAttribute("name") || "";
          const placeholder = field.getAttribute("placeholder") || "";
          const ariaLabel = field.getAttribute("aria-label") || "";
          const id = field.getAttribute("id") || "";
          const allText = `${labelText} ${name} ${placeholder} ${ariaLabel} ${id}`;

          if (!matcher.test(allText)) {
            continue;
          }

          const selector = selectorFromNode(field);
          if (!seen.has(selector)) {
            seen.add(selector);
            selectors.push(selector);
          }
        }

        return selectors.slice(0, 12);
      },
      {
        source: pattern.source,
        flags: pattern.flags
      }
    )
    .catch(() => [] as string[]);

  return result;
}

async function dismissSimplifySidePanel(page: Page): Promise<boolean> {
  const signal = page
    .getByText(/autofill this job application|copilot was just updated|enable ai autofill/i)
    .first();
  if ((await signal.count()) === 0 || !(await safeVisible(signal))) {
    return false;
  }

  const domDismissed = await page
    .evaluate(() => {
      const containers = Array.from(document.querySelectorAll("aside, section, div"));
      const target = containers.find((container) => {
        const text = (container.textContent || "").toLowerCase();
        const rect = container.getBoundingClientRect();
        const style = window.getComputedStyle(container);
        const hasPanelText =
          text.includes("autofill this job application") ||
          text.includes("copilot was just updated") ||
          text.includes("enable ai autofill");

        return (
          rect.width > 220 &&
          rect.height > 200 &&
          (style.position === "fixed" ||
            style.position === "sticky" ||
            style.position === "absolute") &&
          hasPanelText
        );
      });

      if (!target) {
        return false;
      }

      const buttons = Array.from(target.querySelectorAll("button"));
      const close = buttons.find((button) => {
        const node = button as HTMLElement;
        const label = (node.innerText || node.textContent || "").trim().toLowerCase();
        const aria = (node.getAttribute("aria-label") || "").trim().toLowerCase();
        return aria === "close" || label === "x" || label === "×";
      });

      if (close) {
        (close as HTMLElement).click();
        return true;
      }

      const rect = target.getBoundingClientRect();
      const clickX = Math.max(rect.right - 16, rect.left + 16);
      const clickY = rect.top + 16;
      const topRightElement = document.elementFromPoint(clickX, clickY);
      if (topRightElement instanceof HTMLElement) {
        topRightElement.click();
        return true;
      }

      return false;
    })
    .catch(() => false);

  if (domDismissed) {
    await page.waitForTimeout(350);
    if (!(await safeVisible(signal))) {
      return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(350);
  return !(await safeVisible(signal));
}

async function dismissSimplifyResumeModal(page: Page): Promise<boolean> {
  const modalSignals = [
    page.getByText(/land more interviews by optimizing your resume/i).first(),
    page.getByRole("button", { name: /skip better resumes/i }).first(),
    page.getByRole("button", { name: /join now/i }).first()
  ];

  const modalVisible = async (): Promise<boolean> => {
    for (const signal of modalSignals) {
      if ((await signal.count()) > 0 && (await safeVisible(signal))) {
        return true;
      }
    }
    return false;
  };

  if (!(await modalVisible())) {
    return false;
  }

  const closeCandidates: Locator[] = [
    page.getByRole("button", { name: /skip better resumes/i }).first(),
    page.getByRole("button", { name: /^x$/i }).first(),
    page.getByRole("button", { name: /close/i }).first(),
    page.locator("button[aria-label='Close']").first(),
    page
      .locator("button")
      .filter({ hasText: /^\s*×\s*$|^\s*x\s*$/i })
      .first()
  ];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const candidate of closeCandidates) {
      if (await clickLocatorWithFallback(candidate, 2000)) {
        await page.waitForTimeout(400);
      }

      if (!(await modalVisible())) {
        return true;
      }
    }

    const domDismissed = await page
      .evaluate(() => {
        const normalize = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
        const closeRegex = /^(skip better resumes|x|×|close)$/i;
        const elements = Array.from(document.querySelectorAll("button, [role='button']"));

        for (const element of elements) {
          const node = element as HTMLElement;
          const label = normalize(node.innerText || node.textContent || "");
          const aria = normalize(node.getAttribute("aria-label") || "");
          if (closeRegex.test(label) || aria === "close") {
            node.click();
            return true;
          }
        }

        return false;
      })
      .catch(() => false);

    if (domDismissed) {
      await page.waitForTimeout(400);
      if (!(await modalVisible())) {
        return true;
      }
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
    if (!(await modalVisible())) {
      return true;
    }
  }

  return false;
}

export async function connectChrome(cdpEndpoint = DEFAULT_CDP_ENDPOINT): Promise<ConnectedChrome> {
  const browser = (await chromium.connectOverCDP(cdpEndpoint, {
    timeout: 15_000
  })) as Browser;

  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page = await selectBestApplicationPage(context);

  if (!page) {
    page = context.pages()[0] ?? (await context.newPage());
  }

  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);

  return { browser, context, page };
}

async function getPageSnapshotFieldsFallback(page: Page): Promise<SnapshotField[]> {
  const fieldsLocator = page.locator("input, textarea, select");
  const count = await fieldsLocator.count().catch(() => 0);
  if (count === 0) {
    return [];
  }

  const fields: SnapshotField[] = [];
  const limit = Math.min(count, 300);

  for (let index = 0; index < limit; index += 1) {
    const node = fieldsLocator.nth(index);
    const details = await node
      .evaluate((element) => {
        const normalize = (text: string): string => text.trim().replace(/\s+/g, " ");

        const inferLabel = (): string => {
          const labels = Array.from((element as HTMLInputElement).labels || [])
            .map((label) => normalize(label.textContent || ""))
            .filter((value) => value.length > 0);
          if (labels.length > 0) {
            return labels.join(" / ");
          }

          const ariaLabel = normalize(element.getAttribute("aria-label") || "");
          if (ariaLabel.length > 0) {
            return ariaLabel;
          }

          const placeholder = normalize(element.getAttribute("placeholder") || "");
          if (placeholder.length > 0) {
            return placeholder;
          }

          const name = normalize(element.getAttribute("name") || "");
          if (name.length > 0) {
            return name;
          }

          const id = normalize(element.getAttribute("id") || "");
          if (id.length > 0) {
            return id;
          }

          return "";
        };

        const selectorHint = (): string => {
          const id = element.getAttribute("id") || "";
          if (id.length > 0) {
            return `#${id}`;
          }

          const name = element.getAttribute("name") || "";
          if (name.length > 0) {
            return `${element.tagName.toLowerCase()}[name="${name}"]`;
          }

          const placeholder = element.getAttribute("placeholder") || "";
          if (placeholder.length > 0) {
            return `${element.tagName.toLowerCase()}[placeholder*="${placeholder.slice(0, 32)}"]`;
          }

          return element.tagName.toLowerCase();
        };

        const tagName = element.tagName.toLowerCase();
        const type =
          element instanceof HTMLInputElement
            ? element.type || "text"
            : element instanceof HTMLSelectElement
              ? "select"
              : tagName;

        let value = "";
        if (element instanceof HTMLSelectElement) {
          value =
            element.selectedIndex >= 0
              ? element.options[element.selectedIndex]?.text || ""
              : element.value || "";
        } else if ("value" in element) {
          value = (element as HTMLInputElement | HTMLTextAreaElement).value || "";
        }

        return {
          label: inferLabel(),
          type,
          tagName,
          value,
          required:
            (element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement) &&
            element.required
              ? true
              : element.getAttribute("aria-required") === "true",
          selectorHint: selectorHint()
        };
      })
      .catch(() => null as Omit<SnapshotField, "visible"> | null);

    if (!details) {
      continue;
    }

    fields.push({
      ...details,
      visible: await safeVisible(node)
    });
  }

  return fields;
}

export async function getPageSnapshot(page: Page): Promise<PageSnapshot> {
  let fields = await page
    .evaluate(() => {
      const normalize = (text: string): string => text.trim().replace(/\s+/g, " ");

      const selectorHint = (node: Element): string => {
        const id = node.getAttribute("id") || "";
        if (id.length > 0) {
          return `#${id}`;
        }

        const name = node.getAttribute("name") || "";
        if (name.length > 0) {
          return `${node.tagName.toLowerCase()}[name=\"${name}\"]`;
        }

        const placeholder = node.getAttribute("placeholder") || "";
        if (placeholder.length > 0) {
          return `${node.tagName.toLowerCase()}[placeholder*=\"${placeholder.slice(0, 32)}\"]`;
        }

        return node.tagName.toLowerCase();
      };

      const isVisible = (node: Element): boolean => {
        const htmlNode = node as HTMLElement;
        const rect = htmlNode.getBoundingClientRect();
        const style = window.getComputedStyle(htmlNode);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
        return rect.width > 0 && rect.height > 0;
      };

      const inferLabel = (node: Element): string => {
        const labels = Array.from((node as HTMLInputElement).labels || [])
          .map((label) => normalize(label.textContent || ""))
          .filter((value) => value.length > 0);
        if (labels.length > 0) {
          return labels.join(" / ");
        }

        const ariaLabel = normalize(node.getAttribute("aria-label") || "");
        if (ariaLabel.length > 0) {
          return ariaLabel;
        }

        const placeholder = normalize(node.getAttribute("placeholder") || "");
        if (placeholder.length > 0) {
          return placeholder;
        }

        const name = normalize(node.getAttribute("name") || "");
        if (name.length > 0) {
          return name;
        }

        const id = normalize(node.getAttribute("id") || "");
        if (id.length > 0) {
          return id;
        }

        return "";
      };

      const fieldNodes = Array.from(document.querySelectorAll("input, textarea, select"));

      return fieldNodes.slice(0, 300).map((node) => {
        const inputNode = node as HTMLInputElement;
        const tagName = node.tagName.toLowerCase();
        const type = inputNode.type || tagName;
        const value = "value" in inputNode ? inputNode.value || "" : "";

        return {
          label: inferLabel(node),
          type,
          tagName,
          value,
          required: inputNode.required || node.getAttribute("aria-required") === "true",
          visible: isVisible(node),
          selectorHint: selectorHint(node)
        };
      });
    })
    .catch(() => [] as SnapshotField[]);

  if (fields.length === 0) {
    fields = await getPageSnapshotFieldsFallback(page);
  }

  const visibleText = await page
    .evaluate(() => {
      const body = document.body;
      if (!body) {
        return "";
      }
      return (body.innerText || "").trim();
    })
    .catch(() => "");

  const hasSubmitButton = await page
    .evaluate(() => {
      const submitRegex = /submit application|submit|review and submit|finish application/i;
      const candidates = Array.from(
        document.querySelectorAll("button, input[type='submit'], [role='button']")
      );

      for (const candidate of candidates) {
        const node = candidate as HTMLElement;
        const label = (
          node.getAttribute("value") ||
          node.getAttribute("aria-label") ||
          node.innerText ||
          node.textContent ||
          ""
        ).trim();

        if (!submitRegex.test(label)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0";

        if (visible) {
          return true;
        }
      }

      return false;
    })
    .catch(() => false);

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    fields,
    visibleText,
    hasSubmitButton
  };
}

export async function fillField(
  page: Page,
  labelPattern: string | RegExp,
  value: string
): Promise<FillFieldResult> {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return {
      success: false,
      fieldFound: false,
      actualValue: ""
    };
  }

  const regex = toRegExp(labelPattern);

  const labelLocator = page.getByLabel(regex).first();
  const labelCount = await labelLocator.count().catch(() => 0);
  if (labelCount > 0) {
    const actualValue = (await fillLocator(labelLocator, normalizedValue)) ?? "";
    return {
      success: actualValue.length > 0 || normalizedValue.length === 0,
      fieldFound: true,
      actualValue
    };
  }

  const selectors = await listLikelyFieldSelectors(page, regex);

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const actualValue = (await fillLocator(locator, normalizedValue)) ?? "";
    if (actualValue.length > 0) {
      return {
        success: true,
        fieldFound: true,
        actualValue
      };
    }
  }

  if (typeof labelPattern === "string" && labelPattern.trim().length > 0) {
    const trimmed = labelPattern.trim();
    const selectorCandidates = [
      `input${makeCssAttributeContainsSelector("name", trimmed)}`,
      `input${makeCssAttributeContainsSelector("id", trimmed)}`,
      `input${makeCssAttributeContainsSelector("placeholder", trimmed)}`,
      `textarea${makeCssAttributeContainsSelector("name", trimmed)}`,
      `textarea${makeCssAttributeContainsSelector("id", trimmed)}`,
      `textarea${makeCssAttributeContainsSelector("placeholder", trimmed)}`,
      `select${makeCssAttributeContainsSelector("name", trimmed)}`,
      `select${makeCssAttributeContainsSelector("id", trimmed)}`
    ];

    for (const selector of selectorCandidates) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      const actualValue = (await fillLocator(locator, normalizedValue)) ?? "";
      return {
        success: actualValue.length > 0,
        fieldFound: true,
        actualValue
      };
    }
  }

  return {
    success: false,
    fieldFound: false,
    actualValue: ""
  };
}

export async function fillCustomDropdown(
  page: Page,
  labelPattern: string | RegExp,
  searchTerms: string[]
): Promise<FillDropdownResult> {
  const regex = toRegExp(labelPattern);

  const label = page.locator("label").filter({ hasText: regex }).first();
  let trigger = page.locator("");

  if ((await label.count()) > 0 && (await safeVisible(label))) {
    const forId = await label.getAttribute("for");
    if (forId && forId.length > 0) {
      const byFor = page.locator(`#${forId}`).first();
      if ((await byFor.count()) > 0) {
        trigger = byFor;
      }
    }

    if ((await trigger.count()) === 0) {
      trigger = label
        .locator(
          "xpath=ancestor::*[self::div or self::fieldset or self::section][1]//*[self::button or self::input or @role='combobox' or @aria-haspopup='listbox']"
        )
        .first();
    }
  } else {
    trigger = page
      .locator("[role='combobox'], [aria-haspopup='listbox'], button")
      .filter({ hasText: regex })
      .first();
  }

  if ((await trigger.count()) === 0 || !(await safeVisible(trigger))) {
    return { success: false, selectedOption: null };
  }

  const opened = await clickLocatorWithFallback(trigger, 2500);
  if (!opened) {
    return { success: false, selectedOption: null };
  }

  await page.waitForTimeout(250);

  const nonEmptyTerms = searchTerms.map((term) => term.trim()).filter((term) => term.length > 0);

  const searchInput = page
    .locator(
      "[role='listbox'] input, [data-reach-combobox-popover] input, [role='dialog'] input[aria-autocomplete='list'], input[aria-autocomplete='list']"
    )
    .first();

  if (
    nonEmptyTerms.length > 0 &&
    (await searchInput.count()) > 0 &&
    (await safeVisible(searchInput))
  ) {
    await searchInput.fill(nonEmptyTerms[0], { timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }

  for (const term of nonEmptyTerms) {
    const optionRegex = new RegExp(escapeRegExp(term), "i");

    const roleOption = page.getByRole("option", { name: optionRegex }).first();
    if ((await roleOption.count()) > 0 && (await safeVisible(roleOption))) {
      const selectedOption =
        (await roleOption.innerText().catch(() => "")).trim() ||
        (await roleOption.textContent().catch(() => ""))?.trim() ||
        term;
      await roleOption.click({ timeout: 2000 }).catch(() => undefined);
      return {
        success: true,
        selectedOption
      };
    }

    const textOption = page
      .locator("[role='option'], li, [data-option]")
      .filter({ hasText: optionRegex })
      .first();
    if ((await textOption.count()) > 0 && (await safeVisible(textOption))) {
      const selectedOption =
        (await textOption.innerText().catch(() => "")).trim() ||
        (await textOption.textContent().catch(() => ""))?.trim() ||
        term;
      await textOption.click({ timeout: 2000 }).catch(() => undefined);
      return {
        success: true,
        selectedOption
      };
    }
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return { success: false, selectedOption: null };
}

export async function fillTextarea(
  page: Page,
  labelPattern: string | RegExp,
  answer: string
): Promise<FillTextareaResult> {
  const regex = toRegExp(labelPattern);
  const normalized = answer.trim();
  if (normalized.length === 0) {
    return { success: false };
  }

  const byLabel = page.getByLabel(regex).first();
  if ((await byLabel.count()) > 0 && (await safeVisible(byLabel))) {
    const tagName = await byLabel.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "textarea") {
      const actual = await fillLocator(byLabel, normalized);
      return { success: (actual ?? "").length > 0 };
    }
  }

  const selectors = await listLikelyFieldSelectors(page, regex);
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const tagName = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");

    if (tagName !== "textarea") {
      continue;
    }

    const actual = await fillLocator(locator, normalized);
    return { success: (actual ?? "").length > 0 };
  }

  const fallback = page.locator("textarea").filter({ hasText: regex }).first();
  if ((await fallback.count()) > 0 && (await safeVisible(fallback))) {
    const actual = await fillLocator(fallback, normalized);
    return { success: (actual ?? "").length > 0 };
  }

  return { success: false };
}

export async function uploadResume(page: Page, filePath: string): Promise<UploadResumeResult> {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return { success: false };
  }

  const input = page.locator("input[type='file']").first();
  if ((await input.count()) > 0) {
    try {
      await input.setInputFiles(trimmed);
      return { success: true };
    } catch {
      // Continue into chooser-based fallback.
    }
  }

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null);
  const clicked = await clickIfVisible(page, [
    "Upload Resume",
    "Upload resume",
    "Resume/CV",
    "Attach Resume",
    "Choose file"
  ]);
  const chooser = await chooserPromise;

  if (!clicked || !chooser) {
    return { success: false };
  }

  try {
    await chooser.setFiles(trimmed);
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function clickButton(page: Page, textPatterns: string[]): Promise<ClickButtonResult> {
  const clickedText = await clickIfVisible(page, textPatterns);
  return {
    clicked: clickedText !== null,
    text: clickedText
  };
}

export async function takeScreenshot(
  page: Page,
  context: BrowserContext,
  name: string,
  artifactsDir: string
): Promise<ScreenshotResult> {
  const trimmedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "screenshot";
  const outputDir = path.isAbsolute(artifactsDir)
    ? artifactsDir
    : path.resolve(process.cwd(), artifactsDir);

  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `form-fill-${timestamp}-${trimmedName}.png`;
  const absolutePath = path.join(outputDir, fileName);

  let cdpSession: CDPSession | null = null;
  try {
    cdpSession = await context.newCDPSession(page);
    await cdpSession.send("Page.enable").catch(() => undefined);
  } catch {
    cdpSession = null;
  }

  if (cdpSession) {
    try {
      const screenshot = (await cdpSession.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true
      })) as { data: string };
      await writeFile(absolutePath, Buffer.from(screenshot.data, "base64"));
      return {
        success: true,
        path: toPortablePath(path.relative(process.cwd(), absolutePath))
      };
    } catch {
      // Fall through to Playwright screenshot.
    }
  }

  try {
    await page.screenshot({
      path: absolutePath,
      fullPage: false,
      timeout: 5000
    });

    return {
      success: true,
      path: toPortablePath(path.relative(process.cwd(), absolutePath))
    };
  } catch {
    return {
      success: false,
      path: toPortablePath(path.relative(process.cwd(), absolutePath))
    };
  }
}

export async function dismissOverlays(page: Page): Promise<DismissOverlaysResult> {
  const dismissed: string[] = [];

  if (await dismissSimplifySidePanel(page)) {
    dismissed.push("simplify_side_panel");
  }

  if (await dismissSimplifyResumeModal(page)) {
    dismissed.push("simplify_resume_modal");
  }

  const cookieDismissed = await clickIfVisible(page, [
    "Accept All",
    "Accept all",
    "Accept",
    "I Agree",
    "Agree",
    "Got it"
  ]);
  if (cookieDismissed) {
    dismissed.push(`cookie_banner:${cookieDismissed}`);
  }

  const genericClose = await clickIfVisible(page, ["Close", "Dismiss", "No thanks", "Not now"]);
  if (genericClose) {
    dismissed.push(`generic_overlay:${genericClose}`);
  }

  return { dismissed };
}

export async function detectBlockers(page: Page): Promise<BlockerDetectionResult | null> {
  const verifyText = page
    .getByText(/verify you are human|checking your browser|security check|just a moment/i)
    .first();

  if ((await verifyText.count()) > 0 && (await safeVisible(verifyText))) {
    return {
      blocked: true,
      reason: "security_verification"
    };
  }

  const formFieldCount = await page
    .locator("input, textarea, select")
    .count()
    .catch(() => 0);

  const captchaSignals = [
    page.locator("iframe[src*='recaptcha']").first(),
    page.locator("iframe[title*='captcha' i]").first(),
    page.locator(".g-recaptcha").first(),
    page.locator("[data-sitekey]").first(),
    page.getByText(/i am human|verify that you are human|captcha/i).first()
  ];

  for (const signal of captchaSignals) {
    if ((await signal.count()) > 0 && (await safeVisible(signal))) {
      if (formFieldCount < 3) {
        return {
          blocked: true,
          reason: "captcha"
        };
      }

      const challengeText = page
        .getByText(/please complete captcha|verify you are human|i am human|security challenge/i)
        .first();
      if ((await challengeText.count()) > 0 && (await safeVisible(challengeText))) {
        return {
          blocked: true,
          reason: "captcha"
        };
      }
    }
  }

  const body = (
    (await page
      .locator("body")
      .innerText()
      .catch(() => "")) || ""
  ).toLowerCase();

  if (
    body.includes("cloudflare") &&
    (body.includes("checking your browser") || body.includes("verify you are human"))
  ) {
    return {
      blocked: true,
      reason: "security_verification"
    };
  }

  if (
    (body.includes("captcha") || body.includes("turnstile") || body.includes("recaptcha")) &&
    formFieldCount < 2
  ) {
    return {
      blocked: true,
      reason: "captcha"
    };
  }

  if (body.includes("two-factor") || body.includes("authentication code") || body.includes("2fa")) {
    return {
      blocked: true,
      reason: "two_factor_required"
    };
  }

  const needsLogin = body.includes("sign in") || body.includes("log in") || body.includes("login");
  const hasPasswordField =
    (await page
      .locator("input[type='password']")
      .count()
      .catch(() => 0)) > 0;
  if (needsLogin && hasPasswordField) {
    return {
      blocked: true,
      reason: "login_required"
    };
  }

  return null;
}

export async function scrollPage(
  page: Page,
  direction: "up" | "down" | "top" | "bottom"
): Promise<ScrollPageResult> {
  const values = await page.evaluate((requestedDirection) => {
    const currentY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      viewportHeight
    );

    if (requestedDirection === "up") {
      window.scrollBy(0, -Math.floor(viewportHeight * 0.8));
    } else if (requestedDirection === "down") {
      window.scrollBy(0, Math.floor(viewportHeight * 0.8));
    } else if (requestedDirection === "top") {
      window.scrollTo(0, 0);
    } else if (requestedDirection === "bottom") {
      window.scrollTo(0, pageHeight);
    }

    return {
      previousY: currentY,
      scrollY: window.scrollY,
      pageHeight
    };
  }, direction);

  return {
    scrollY: values.scrollY,
    pageHeight: values.pageHeight
  };
}

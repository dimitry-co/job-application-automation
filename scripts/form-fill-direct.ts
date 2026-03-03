import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page
} from "@playwright/test";

type ManualActionReason =
  | "security_verification"
  | "captcha"
  | "login_required"
  | "two_factor_required"
  | "network_blocked"
  | "runner_busy"
  | "unknown";

type ProfileData = {
  source: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phone: string;
  country: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  linkedin: string;
  github: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  gpa: string;
  graduation: string;
  password: string;
  resumePath: string;
};

type FormFillOutput = {
  stoppedAtSubmit: boolean;
  screenshotPaths: string[];
  finalUrl: string;
  manualActionRequired: boolean;
  manualActionReason: ManualActionReason | null;
  orderedReasons: string[];
  skillDeviationReasons: string[];
};

const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";
const ARTIFACTS_DIR = path.resolve(process.cwd(), "artifacts");
const PROFILE_LOCAL_PATH = path.resolve(process.cwd(), "user-profile.local.md");
const PROFILE_FALLBACK_PATH = path.resolve(process.cwd(), "user-profile.md");

function normalizeCellValue(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    /\(leave blank(?: unless needed)?\)/i.test(trimmed) ||
    /\(fill if required by portal\)/i.test(trimmed)
  ) {
    return "";
  }
  return trimmed;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nowStamp(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveResumePath(profileMarkdown: string): Promise<string> {
  const lineMatches = [
    ...profileMarkdown.matchAll(/`([^`]+\.pdf)`/g),
    ...profileMarkdown.matchAll(/(?:^|\s)(\/[^\s]+\.pdf)(?:$|\s)/gm)
  ];

  for (const match of lineMatches) {
    const candidate = (match[1] ?? "").trim();
    if (!candidate) {
      continue;
    }
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate);
    if (await fileExists(absolute)) {
      return absolute;
    }
  }

  const defaultCandidates = [
    path.resolve(process.cwd(), "data/resumes/resume-student.pdf"),
    path.resolve(process.cwd(), "data/resumes/resume-experienced.pdf"),
    path.resolve(process.cwd(), "data/resumes/resume.pdf")
  ];
  for (const candidate of defaultCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return "";
}

function parseMarkdownTables(markdown: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 2) {
      continue;
    }

    if (/^[-\s]+$/.test(cells[0]) || /^[-\s]+$/.test(cells[1])) {
      continue;
    }

    if (/^(Field|Type|Question)$/i.test(cells[0])) {
      continue;
    }

    fields.set(cells[0], cells[1]);
  }

  return fields;
}

async function loadProfile(): Promise<ProfileData> {
  let sourcePath = PROFILE_LOCAL_PATH;
  let markdown = "";
  if (await fileExists(PROFILE_LOCAL_PATH)) {
    markdown = await readFile(PROFILE_LOCAL_PATH, "utf8");
  } else {
    sourcePath = PROFILE_FALLBACK_PATH;
    markdown = await readFile(PROFILE_FALLBACK_PATH, "utf8");
  }

  const fields = parseMarkdownTables(markdown);
  const resumePath = await resolveResumePath(markdown);

  return {
    source: path.basename(sourcePath),
    firstName: normalizeCellValue(fields.get("First Name")),
    lastName: normalizeCellValue(fields.get("Last Name")),
    preferredName: normalizeCellValue(fields.get("Preferred Name")),
    email: normalizeCellValue(fields.get("Email")),
    phone: normalizeCellValue(fields.get("Phone Number")),
    country: normalizeCellValue(fields.get("Country")) || "United States",
    address1: normalizeCellValue(fields.get("Address Line 1")),
    city: normalizeCellValue(fields.get("City")),
    state: normalizeCellValue(fields.get("State")),
    zip: normalizeCellValue(fields.get("Zip/Postal Code")),
    linkedin: normalizeCellValue(fields.get("LinkedIn")),
    github: normalizeCellValue(fields.get("GitHub")),
    school: normalizeCellValue(fields.get("School")),
    degree: normalizeCellValue(fields.get("Degree")),
    fieldOfStudy: normalizeCellValue(fields.get("Field of Study")),
    gpa: normalizeCellValue(fields.get("GPA")),
    graduation:
      normalizeCellValue(fields.get("Expected Graduation")) ||
      normalizeCellValue(fields.get("Graduation Date")),
    password: normalizeCellValue(fields.get("Password")),
    resumePath
  };
}

async function safeVisible(locator: ReturnType<Page["locator"]>): Promise<boolean> {
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
    // Continue to force/evaluate click fallbacks.
  }

  try {
    await locator.click({ timeout: timeoutMs, force: true });
    return true;
  } catch {
    // Continue to JS click fallback.
  }

  try {
    const clicked = await locator.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      element.click();
      return true;
    });
    return clicked;
  } catch {
    return false;
  }
}

async function clickByTextViaDom(page: Page, text: string): Promise<boolean> {
  const escaped = escapeRegExp(text.trim());
  if (escaped.length === 0) {
    return false;
  }
  const regexSource = `^\\s*${escaped}\\s*$`;

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
    }, regexSource);
  } catch {
    return false;
  }
}

async function clickIfVisible(
  page: Page,
  candidates: string[],
  timeoutMs = 3000
): Promise<string | null> {
  for (const text of candidates) {
    const escaped = escapeRegExp(text);
    const exactRegex = new RegExp(`^\\s*${escaped}\\s*$`, "i");
    const looseRegex = new RegExp(escaped, "i");

    const button = page.getByRole("button", { name: exactRegex }).first();
    if (await clickLocatorWithFallback(button, timeoutMs)) {
      return text;
    }

    const link = page.getByRole("link", { name: exactRegex }).first();
    if (await clickLocatorWithFallback(link, timeoutMs)) {
      return text;
    }

    const roleButton = page.locator("[role='button']").filter({ hasText: exactRegex }).first();
    if (await clickLocatorWithFallback(roleButton, timeoutMs)) {
      return text;
    }

    const textLocator = page.getByText(looseRegex).first();
    if (await clickLocatorWithFallback(textLocator, timeoutMs)) {
      return text;
    }

    if (await clickByTextViaDom(page, text)) {
      return text;
    }
  }
  return null;
}

async function setTextLikeField(page: Page, selector: string, value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  const field = page.locator(selector).first();
  if ((await field.count()) === 0 || !(await safeVisible(field))) {
    return false;
  }

  try {
    await field.click({ timeout: 1500 });
    await field
      .press(process.platform === "darwin" ? "Meta+A" : "Control+A")
      .catch(() => undefined);
    await field.fill(value, { timeout: 2500 });
    await field.press("Tab").catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function fillByLabel(page: Page, labelRegex: RegExp, value: string): Promise<boolean> {
  if (!value) {
    return false;
  }
  const field = page.getByLabel(labelRegex).first();
  if ((await field.count()) === 0 || !(await safeVisible(field))) {
    return false;
  }

  const tag = (await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => "")) || "";
  if (tag === "select") {
    try {
      await field.selectOption({ label: value });
      return true;
    } catch {
      try {
        await field.selectOption({ value });
        return true;
      } catch {
        return false;
      }
    }
  }

  try {
    await field.click({ timeout: 1500 });
    await field
      .press(process.platform === "darwin" ? "Meta+A" : "Control+A")
      .catch(() => undefined);
    await field.fill(value, { timeout: 2500 });
    await field.press("Tab").catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function fillCustomDropdown(
  page: Page,
  labelRegex: RegExp,
  searchTerms: string[]
): Promise<boolean> {
  const label = page.locator("label").filter({ hasText: labelRegex }).first();
  let trigger = page.locator("");

  if ((await label.count()) > 0 && (await safeVisible(label))) {
    const forId = await label.getAttribute("for");
    if (forId) {
      const direct = page.locator(`#${forId}`).first();
      if ((await direct.count()) > 0) {
        trigger = direct;
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
      .filter({ hasText: labelRegex })
      .first();
  }

  if ((await trigger.count()) === 0 || !(await safeVisible(trigger))) {
    return false;
  }

  try {
    await trigger.click({ timeout: 2000 });
  } catch {
    return false;
  }

  await page.waitForTimeout(250);

  const nonEmptySearchTerms = searchTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  const searchInput = page
    .locator(
      "[role='listbox'] input, [data-reach-combobox-popover] input, [role='dialog'] input[aria-autocomplete='list'], input[aria-autocomplete='list']"
    )
    .first();

  if (
    (await searchInput.count()) > 0 &&
    (await safeVisible(searchInput)) &&
    nonEmptySearchTerms.length > 0
  ) {
    await searchInput.fill(nonEmptySearchTerms[0], { timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }

  for (const term of nonEmptySearchTerms) {
    const escaped = escapeRegExp(term);
    const optionRegex = new RegExp(escaped, "i");
    const roleOption = page.getByRole("option", { name: optionRegex }).first();
    if ((await roleOption.count()) > 0 && (await safeVisible(roleOption))) {
      await roleOption.click({ timeout: 2000 }).catch(() => undefined);
      return true;
    }

    const textOption = page
      .locator("[role='option'], li, [data-option]")
      .filter({ hasText: optionRegex })
      .first();
    if ((await textOption.count()) > 0 && (await safeVisible(textOption))) {
      await textOption.click({ timeout: 2000 }).catch(() => undefined);
      return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return false;
}

async function fillCommonFields(page: Page, profile: ProfileData): Promise<void> {
  const textSteps: Array<{ label: RegExp; value: string; selectors: string[] }> = [
    {
      label: /first\s*name|given\s*name/i,
      value: profile.firstName,
      selectors: ["input[name*='first' i]", "input[autocomplete='given-name']"]
    },
    {
      label: /last\s*name|family\s*name|surname/i,
      value: profile.lastName,
      selectors: ["input[name*='last' i]", "input[autocomplete='family-name']"]
    },
    {
      label: /preferred\s*name|nickname/i,
      value: profile.preferredName,
      selectors: ["input[name*='preferred' i]", "input[name*='nick' i]"]
    },
    {
      label: /email/i,
      value: profile.email,
      selectors: ["input[type='email']", "input[name*='email' i]"]
    },
    {
      label: /phone|mobile/i,
      value: profile.phone,
      selectors: ["input[type='tel']", "input[name*='phone' i]"]
    },
    {
      label: /address|street/i,
      value: profile.address1,
      selectors: ["input[name*='address' i]"]
    },
    {
      label: /city/i,
      value: profile.city,
      selectors: ["input[name*='city' i]"]
    },
    {
      label: /state|province/i,
      value: profile.state,
      selectors: ["input[name*='state' i]", "input[name*='province' i]"]
    },
    {
      label: /zip|postal/i,
      value: profile.zip,
      selectors: ["input[name*='zip' i]", "input[name*='postal' i]"]
    },
    {
      label: /linkedin/i,
      value: profile.linkedin,
      selectors: ["input[name*='linkedin' i]"]
    },
    {
      label: /github|portfolio|website/i,
      value: profile.github,
      selectors: [
        "input[name*='github' i]",
        "input[name*='portfolio' i]",
        "input[name*='website' i]"
      ]
    }
  ];

  for (const step of textSteps) {
    const byLabel = await fillByLabel(page, step.label, step.value);
    if (byLabel) {
      continue;
    }
    for (const selector of step.selectors) {
      const filled = await setTextLikeField(page, selector, step.value);
      if (filled) {
        break;
      }
    }
  }

  await fillByLabel(page, /school|university|institution/i, profile.school);
  await fillByLabel(page, /degree/i, profile.degree);
  await fillByLabel(page, /major|field\s*of\s*study|discipline/i, profile.fieldOfStudy);
  await fillByLabel(page, /gpa/i, profile.gpa);
  await fillByLabel(page, /graduation|expected\s*graduation|end\s*date/i, profile.graduation);

  await fillCustomDropdown(page, /school|university|institution/i, [profile.school]);
  await fillCustomDropdown(page, /degree/i, [profile.degree, "Bachelor"]);
  await fillCustomDropdown(page, /major|field\s*of\s*study|discipline/i, [
    profile.fieldOfStudy,
    "Computer"
  ]);
  await fillCustomDropdown(page, /country/i, [profile.country, "United"]);
  await fillCustomDropdown(page, /state|province/i, [profile.state, "New York"]);
  await fillCustomDropdown(page, /gender/i, ["Prefer not to answer", "Decline"]);
  await fillCustomDropdown(page, /race|ethnicity/i, ["Prefer not", "Decline"]);
  await fillCustomDropdown(page, /veteran/i, ["not a protected veteran", "not"]);
  await fillCustomDropdown(page, /disability/i, ["do not have", "No"]);
}

async function clickBinaryQuestion(
  page: Page,
  questionRegex: RegExp,
  answerRegex: RegExp
): Promise<void> {
  const container = page
    .locator("fieldset, div, section")
    .filter({ hasText: questionRegex })
    .first();
  if ((await container.count()) === 0) {
    return;
  }

  const label = container.getByLabel(answerRegex).first();
  if ((await label.count()) > 0 && (await safeVisible(label))) {
    await label.check({ timeout: 1500 }).catch(async () => {
      await label.click({ timeout: 1500 }).catch(() => undefined);
    });
    return;
  }

  const radio = container.getByRole("radio", { name: answerRegex }).first();
  if ((await radio.count()) > 0 && (await safeVisible(radio))) {
    await radio.click({ timeout: 1500 }).catch(() => undefined);
    return;
  }

  const text = container.getByText(answerRegex).first();
  if ((await text.count()) > 0 && (await safeVisible(text))) {
    await text.click({ timeout: 1500 }).catch(() => undefined);
  }
}

async function fillYesNoQuestions(page: Page): Promise<void> {
  await clickBinaryQuestion(page, /authorized\s*to\s*work|legally\s*authorized/i, /yes/i);
  await clickBinaryQuestion(page, /require\s*visa|sponsorship/i, /no/i);
  await clickBinaryQuestion(page, /willing\s*to\s*relocate/i, /yes/i);
  await clickBinaryQuestion(page, /relative\s*works|related\s*to\s*employee/i, /no/i);
  await clickBinaryQuestion(page, /referral|referred/i, /no/i);
  await clickBinaryQuestion(page, /previously\s*worked|worked\s*here/i, /no/i);
  await clickBinaryQuestion(page, /current\s*employee/i, /no/i);
}

async function fillTextareas(page: Page): Promise<void> {
  const genericWhy =
    "I am excited about this opportunity because it aligns with my interest in building reliable software with strong collaboration. I can contribute through hands-on project experience, fast learning, and consistent delivery while growing through mentorship and real engineering impact.";
  const genericFit =
    "I am a strong fit because I have built full-stack and backend-heavy projects with TypeScript, React/Next.js, APIs, and testing. I am comfortable debugging complex issues, writing maintainable code, and collaborating with a team to ship reliable features.";
  const genericGoals =
    "My long-term goal is to grow into a strong software engineer by improving system design, reliability, and performance skills. This role contributes by giving production experience, mentorship, and opportunities to solve real user problems.";

  const areas = page.locator("textarea");
  const areaCount = await areas.count();

  for (let i = 0; i < areaCount; i += 1) {
    const area = areas.nth(i);
    if (!(await safeVisible(area))) {
      continue;
    }
    const current = (await area.inputValue().catch(() => "")).trim();
    if (current.length > 0) {
      continue;
    }

    const ctx = `${(await area.getAttribute("name").catch(() => "")) ?? ""} ${
      (await area.getAttribute("id").catch(() => "")) ?? ""
    } ${(await area.getAttribute("placeholder").catch(() => "")) ?? ""}`.toLowerCase();

    let answer = genericFit;
    if (ctx.includes("why")) {
      answer = genericWhy;
    }
    if (ctx.includes("goal")) {
      answer = genericGoals;
    }
    if (ctx.includes("hear")) {
      answer = "Glassdoor";
    }

    await area.click({ timeout: 1500 }).catch(() => undefined);
    await area.fill(answer, { timeout: 2500 }).catch(() => undefined);
    await area.press("Tab").catch(() => undefined);
  }
}

async function uploadResume(
  page: Page,
  profile: ProfileData,
  output: FormFillOutput
): Promise<void> {
  if (!profile.resumePath) {
    return;
  }
  const input = page.locator("input[type='file']").first();
  if ((await input.count()) > 0 && (await safeVisible(input))) {
    await input.setInputFiles(profile.resumePath).catch(() => undefined);
    output.orderedReasons.push("resume_upload_attempted");
    return;
  }

  const trigger = await clickIfVisible(page, [
    "Upload Resume",
    "Upload resume",
    "Resume/CV",
    "Attach Resume",
    "Choose file"
  ]);
  if (trigger) {
    const chooser = await page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null);
    if (chooser) {
      await chooser.setFiles(profile.resumePath).catch(() => undefined);
      output.orderedReasons.push("resume_upload_attempted");
    }
  }
}

async function detectBlockers(page: Page): Promise<ManualActionReason | null> {
  const verifyText = page
    .getByText(/verify you are human|checking your browser|security check|just a moment/i)
    .first();
  if ((await verifyText.count()) > 0 && (await safeVisible(verifyText))) {
    return "security_verification";
  }

  const captchaSignals = [
    page.locator("iframe[src*='recaptcha']").first(),
    page.locator("iframe[title*='captcha' i]").first(),
    page.locator(".g-recaptcha").first(),
    page.locator("[data-sitekey]").first(),
    page.getByText(/i am human|verify that you are human|captcha/i).first()
  ];
  const formFieldCount = await page
    .locator("input, textarea, select")
    .count()
    .catch(() => 0);
  for (const signal of captchaSignals) {
    if ((await signal.count()) > 0 && (await safeVisible(signal))) {
      if (formFieldCount < 3) {
        return "captcha";
      }
      const challengeText = page.getByText(
        /please complete captcha|verify you are human|i am human|security challenge/i
      );
      if ((await challengeText.count()) > 0 && (await safeVisible(challengeText.first()))) {
        return "captcha";
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
    return "security_verification";
  }

  if (
    (body.includes("captcha") || body.includes("turnstile") || body.includes("recaptcha")) &&
    formFieldCount < 2
  ) {
    return "captcha";
  }
  if (body.includes("two-factor") || body.includes("authentication code") || body.includes("2fa")) {
    return "two_factor_required";
  }
  const needsLogin = body.includes("sign in") || body.includes("log in") || body.includes("login");
  if (needsLogin && (await page.locator("input[type='password']").count()) > 0) {
    return "login_required";
  }
  return null;
}

async function closeSimplifySidePanel(page: Page, output: FormFillOutput): Promise<boolean> {
  const signal = page
    .getByText(/Autofill this job application|Copilot was just updated|Enable AI autofill/i)
    .first();
  if ((await signal.count()) === 0 || !(await safeVisible(signal))) {
    return false;
  }

  const domDismissed = await page.evaluate(() => {
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
  });

  if (domDismissed) {
    output.orderedReasons.push("dismissed_simplify_side_panel_dom");
    await page.waitForTimeout(350);
    if (!(await safeVisible(signal))) {
      return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(350);
  if (!(await safeVisible(signal))) {
    output.orderedReasons.push("dismissed_simplify_side_panel_escape");
    return true;
  }

  return false;
}

async function detectSubmitVisible(page: Page): Promise<boolean> {
  const submitCandidates = [
    page.getByRole("button", { name: /submit application|submit/i }).first(),
    page.getByRole("button", { name: /review and submit|finish application/i }).first(),
    page.getByText(/submit application|review and submit/i).first()
  ];

  for (const candidate of submitCandidates) {
    if ((await candidate.count()) > 0 && (await safeVisible(candidate))) {
      return true;
    }
  }
  return false;
}

async function clickNextStep(page: Page): Promise<boolean> {
  const isLikelySimplifyListing = page.url().includes("simplify.jobs");
  if (isLikelySimplifyListing) {
    const formFieldCount = await page
      .locator("form input, form select, form textarea")
      .count()
      .catch(() => 0);
    if (formFieldCount < 3) {
      return false;
    }
  }

  const nextCandidates = [
    page.getByRole("button", { name: /save and continue|continue|next/i }).first(),
    page.getByText(/save and continue|continue|next/i).first()
  ];
  for (const candidate of nextCandidates) {
    if ((await candidate.count()) > 0 && (await safeVisible(candidate))) {
      await candidate.click({ timeout: 2500 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function closeSimplifyResumeModal(page: Page, output: FormFillOutput): Promise<boolean> {
  const modalSignals = [
    page.getByText(/Land More Interviews By Optimizing Your Resume!/i).first(),
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

  output.orderedReasons.push("simplify_modal_detected");

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

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    for (const candidate of closeCandidates) {
      if (await clickLocatorWithFallback(candidate, 2500)) {
        await page.waitForTimeout(500);
      }
      if (!(await modalVisible())) {
        output.orderedReasons.push(`dismissed_simplify_modal_attempt_${attempt}`);
        return true;
      }
    }

    const domDismissed = await page.evaluate(() => {
      const normalized = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
      const closeRegex = /^(skip better resumes|x|×|close)$/i;
      const elements = Array.from(document.querySelectorAll("button, [role='button']"));
      for (const element of elements) {
        const node = element as HTMLElement;
        const label = normalized(node.innerText || node.textContent || "");
        const aria = normalized(node.getAttribute("aria-label") ?? "");
        if (closeRegex.test(label) || aria === "close") {
          node.click();
          return true;
        }
      }
      return false;
    });
    if (domDismissed) {
      await page.waitForTimeout(500);
      if (!(await modalVisible())) {
        output.orderedReasons.push(`dismissed_simplify_modal_dom_attempt_${attempt}`);
        return true;
      }
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(450);
    if (!(await modalVisible())) {
      output.orderedReasons.push(`dismissed_simplify_modal_escape_attempt_${attempt}`);
      return true;
    }
  }

  output.orderedReasons.push("simplify_modal_not_dismissed");
  return false;
}

type PageChoice = {
  page: Page;
  score: number;
};

async function scorePageForFormFill(page: Page): Promise<number> {
  const url = page.url();
  if (!url || url.startsWith("chrome://")) {
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

async function selectBestApplicationPage(
  context: BrowserContext,
  fallbackPage: Page
): Promise<Page> {
  const candidates = context.pages();
  const scored: PageChoice[] = [];

  for (const candidate of candidates) {
    const score = await scorePageForFormFill(candidate);
    if (Number.isFinite(score)) {
      scored.push({ page: candidate, score });
    }
  }

  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0) {
    await fallbackPage.bringToFront().catch(() => undefined);
    return fallbackPage;
  }

  await best.page.bringToFront().catch(() => undefined);
  await best.page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
  return best.page;
}

async function switchToExternalApplicationTab(
  context: BrowserContext,
  currentPage: Page
): Promise<Page> {
  const bestPage = await selectBestApplicationPage(context, currentPage);
  if (!bestPage.url().includes("simplify.jobs")) {
    return bestPage;
  }

  const currentPages = context.pages();
  const nonChromePages = currentPages.filter((candidate) => {
    const url = candidate.url();
    return url.length > 0 && !url.startsWith("chrome://");
  });

  const newExternal = nonChromePages.find(
    (candidate) => !candidate.url().includes("simplify.jobs")
  );
  if (newExternal) {
    await newExternal.bringToFront().catch(() => undefined);
    await newExternal
      .waitForLoadState("domcontentloaded", { timeout: 30000 })
      .catch(() => undefined);
    return newExternal;
  }

  await currentPage.bringToFront().catch(() => undefined);
  return currentPage;
}

async function tryClickSimplifyCtas(page: Page): Promise<string | null> {
  const manual = await clickIfVisible(page, [
    "I'll apply manually",
    "I’ll apply manually",
    "Apply manually"
  ]);
  if (manual) {
    return "apply_manually";
  }

  const apply = await clickIfVisible(page, [
    "Apply",
    "Apply Now",
    "Start Application",
    "Continue to application"
  ]);
  if (apply) {
    return apply.toLowerCase().replace(/\s+/g, "_");
  }

  return null;
}

async function openExternalApplicationFromSimplify(
  context: BrowserContext,
  page: Page,
  output: FormFillOutput
): Promise<Page> {
  let activePage = page;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!activePage.url().includes("simplify.jobs")) {
      return activePage;
    }

    await closeSimplifyResumeModal(activePage, output);
    const beforePages = new Set(context.pages());
    const newPagePromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    const clicked = await tryClickSimplifyCtas(activePage);
    const eventPage = await newPagePromise;

    if (clicked) {
      output.orderedReasons.push(`simplify_cta_attempt_${attempt}:${clicked}`);
    } else {
      output.orderedReasons.push(`simplify_cta_not_found_attempt_${attempt}`);
      await activePage.waitForTimeout(700);
      continue;
    }

    await activePage.waitForTimeout(1600);

    if (eventPage) {
      activePage = eventPage;
      output.orderedReasons.push(`new_page_opened_from_simplify_attempt_${attempt}`);
    } else {
      const openedByDiff = context.pages().filter((candidate) => !beforePages.has(candidate));
      if (openedByDiff.length > 0) {
        const newest = openedByDiff[openedByDiff.length - 1];
        if (newest) {
          activePage = newest;
          output.orderedReasons.push(`new_page_found_by_diff_attempt_${attempt}`);
        }
      }
    }

    activePage = await switchToExternalApplicationTab(context, activePage);
    await activePage
      .waitForLoadState("domcontentloaded", { timeout: 30000 })
      .catch(() => undefined);
    if (!activePage.url().includes("simplify.jobs")) {
      return activePage;
    }
  }

  return activePage;
}

async function captureStepScreenshot(
  page: Page,
  cdpSession: CDPSession | null,
  prefix: string,
  output: FormFillOutput,
  counter: { value: number },
  stamp: string
): Promise<void> {
  const fileName = `form-fill-${stamp}-${String(counter.value).padStart(2, "0")}-${prefix}.png`;
  const absolute = path.join(ARTIFACTS_DIR, fileName);
  let captured = false;

  if (cdpSession) {
    try {
      const screenshot = (await cdpSession.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true
      })) as { data: string };
      await writeFile(absolute, Buffer.from(screenshot.data, "base64"));
      captured = true;
    } catch {
      // Fall back to Playwright screenshot.
    }
  }

  if (!captured) {
    try {
      await page.screenshot({
        path: absolute,
        fullPage: false,
        timeout: 5000
      });
      captured = true;
    } catch {
      output.orderedReasons.push(`screenshot_failed:${prefix}`);
    }
  }

  if (captured) {
    output.screenshotPaths.push(path.posix.join("artifacts", fileName));
    counter.value += 1;
  }
}

async function withOverallTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`workflow_timeout_${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function run(): Promise<void> {
  const urlArg = process.argv[2];
  const outputPathArg = process.argv[3];
  const cdpEndpointArg = process.argv[4] ?? process.env.CDP_ENDPOINT ?? DEFAULT_CDP_ENDPOINT;

  if (!urlArg || !outputPathArg) {
    throw new Error("Usage: form-fill-direct.ts <application_url> <output_file> [cdp_endpoint]");
  }

  const output: FormFillOutput = {
    stoppedAtSubmit: false,
    screenshotPaths: [],
    finalUrl: urlArg,
    manualActionRequired: false,
    manualActionReason: null,
    orderedReasons: [],
    skillDeviationReasons: []
  };

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const stamp = nowStamp();
  const screenshotCounter = { value: 1 };
  let cdpSession: CDPSession | null = null;

  const finalize = async (): Promise<void> => {
    await writeFile(outputPathArg, JSON.stringify(output), "utf8");
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exit(0);
  };

  try {
    const profile = await loadProfile();
    output.orderedReasons.push(`profile_loaded:${profile.source}`);

    let context: BrowserContext;
    let page: Page;

    try {
      const browser = (await chromium.connectOverCDP(cdpEndpointArg, {
        timeout: 15000
      })) as Browser;
      context = browser.contexts()[0] ?? (await browser.newContext());
      page = await context.newPage();
    } catch {
      output.manualActionRequired = true;
      output.manualActionReason = "network_blocked";
      output.orderedReasons.push("cdp_connection_failed");
      await finalize();
      return;
    }

    try {
      cdpSession = await context.newCDPSession(page);
      await cdpSession.send("Page.enable").catch(() => undefined);
    } catch {
      cdpSession = null;
    }

    await withOverallTimeout(
      (async () => {
        await page.goto(urlArg, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(1200);
        output.finalUrl = page.url();
        await captureStepScreenshot(page, cdpSession, "landing", output, screenshotCounter, stamp);

        const clickedApply = await clickIfVisible(page, [
          "Apply",
          "Apply Now",
          "Start Application",
          "Continue to application"
        ]);
        if (clickedApply) {
          await page.waitForTimeout(1800);
          output.orderedReasons.push(`clicked:${clickedApply.toLowerCase().replace(/\s+/g, "_")}`);
          await captureStepScreenshot(
            page,
            cdpSession,
            "after-apply-click",
            output,
            screenshotCounter,
            stamp
          );
        }

        let manualApplyHandled = false;
        if (page.url().includes("simplify.jobs")) {
          page = await openExternalApplicationFromSimplify(context, page, output);
          manualApplyHandled = !page.url().includes("simplify.jobs");

          try {
            cdpSession = await context.newCDPSession(page);
            await cdpSession.send("Page.enable").catch(() => undefined);
          } catch {
            cdpSession = null;
          }

          output.finalUrl = page.url();
          await captureStepScreenshot(
            page,
            cdpSession,
            "after-simplify-launch-attempt",
            output,
            screenshotCounter,
            stamp
          );
        }

        if (!manualApplyHandled) {
          const clickedManual = await clickIfVisible(page, [
            "I'll apply manually",
            "I’ll apply manually",
            "Apply manually"
          ]);
          if (clickedManual) {
            await page.waitForTimeout(1800);
            output.orderedReasons.push("clicked:apply_manually");
            page = await switchToExternalApplicationTab(context, page);
            output.finalUrl = page.url();
            await captureStepScreenshot(
              page,
              cdpSession,
              "after-manual-apply-click",
              output,
              screenshotCounter,
              stamp
            );
          }
        }

        if (page.url().includes("simplify.jobs")) {
          const simplifyFieldCount = await page
            .locator("form input, form select, form textarea")
            .count()
            .catch(() => 0);
          if (simplifyFieldCount < 3) {
            output.manualActionRequired = true;
            output.manualActionReason = "unknown";
            output.orderedReasons.push("external_application_not_opened");
            await page.waitForTimeout(1800);
            await captureStepScreenshot(
              page,
              cdpSession,
              "external-not-opened",
              output,
              screenshotCounter,
              stamp
            );
            return;
          }
        }

        await closeSimplifySidePanel(page, output);

        const blocker = await detectBlockers(page);
        if (blocker) {
          output.manualActionRequired = true;
          output.manualActionReason = blocker;
          output.orderedReasons.push(`${blocker}_detected`);
          await captureStepScreenshot(
            page,
            cdpSession,
            `blocked-${blocker}`,
            output,
            screenshotCounter,
            stamp
          );
          return;
        }

        for (let step = 1; step <= 4; step += 1) {
          await closeSimplifySidePanel(page, output);
          await fillCommonFields(page, profile);
          await uploadResume(page, profile, output);
          await fillYesNoQuestions(page);
          await fillTextareas(page);

          await captureStepScreenshot(
            page,
            cdpSession,
            `after-fill-step-${step}`,
            output,
            screenshotCounter,
            stamp
          );

          if (await detectSubmitVisible(page)) {
            output.stoppedAtSubmit = true;
            output.finalUrl = page.url();
            await captureStepScreenshot(
              page,
              cdpSession,
              "submit-visible",
              output,
              screenshotCounter,
              stamp
            );
            return;
          }

          const advanced = await clickNextStep(page);
          if (!advanced) {
            break;
          }

          await page.waitForTimeout(1500);
          output.finalUrl = page.url();
          await captureStepScreenshot(
            page,
            cdpSession,
            `after-next-step-${step}`,
            output,
            screenshotCounter,
            stamp
          );
        }

        if (!output.stoppedAtSubmit) {
          output.manualActionRequired = true;
          output.manualActionReason = "unknown";
          output.orderedReasons.push("submit_not_reached");
        }
      })(),
      150000
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.manualActionRequired = true;
    if (message.includes("workflow_timeout_")) {
      output.manualActionReason = "runner_busy";
      output.orderedReasons.push("workflow_timeout");
    } else {
      output.manualActionReason = "unknown";
      output.orderedReasons.push(`unexpected_error:${message.slice(0, 160)}`);
    }
  }

  await finalize();
}

void run();

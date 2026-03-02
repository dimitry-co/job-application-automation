import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

export interface FormFillResult {
  stoppedAtSubmit: boolean;
  screenshotPaths: string[];
  finalUrl: string;
}

const ARTIFACTS_DIR = "artifacts";

export async function autoFillApplication(applicationUrl: string): Promise<FormFillResult> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });

    // Bootstrap safety: do not submit any form automatically.
    const hasSubmit = await page.locator('button:has-text("Submit"), input[type="submit"]').count();

    const screenshotPath = `${ARTIFACTS_DIR}/form-fill-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      stoppedAtSubmit: hasSubmit > 0,
      screenshotPaths: [screenshotPath],
      finalUrl: page.url()
    };
  } finally {
    // Intentionally keep browser open during real run; close for bootstrap placeholder.
    await browser.close();
  }
}

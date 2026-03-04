#!/usr/bin/env tsx

import {
  clickButton,
  connectChrome,
  detectBlockers,
  dismissOverlays,
  fillCustomDropdown,
  fillField,
  fillTextarea,
  getPageSnapshot,
  scrollPage,
  takeScreenshot,
  uploadResume
} from "../src/lib/form-fill-tools";

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Map<string, string[]>;
};

function parseCliArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "";
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];

      if (!next || next.startsWith("--")) {
        flags.set(key, [...(flags.get(key) ?? []), "true"]);
        continue;
      }

      flags.set(key, [...(flags.get(key) ?? []), next]);
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return {
    command,
    positionals,
    flags
  };
}

function getFlag(args: ParsedArgs, key: string): string | undefined {
  const values = args.flags.get(key);
  if (!values || values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

function getRequiredFlag(args: ParsedArgs, key: string): string {
  const value = getFlag(args, key);
  if (!value || value.trim().length === 0) {
    throw new Error(`missing_required_flag:${key}`);
  }
  return value;
}

function getRepeatedFlag(args: ParsedArgs, key: string): string[] {
  return (args.flags.get(key) ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function writeJsonAndExit(payload: unknown): never {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(0);
}

async function resolvePageForCommand(
  defaultPage: Awaited<ReturnType<typeof connectChrome>>["page"],
  context: Awaited<ReturnType<typeof connectChrome>>["context"],
  urlFilter: string | undefined,
  navigateIfMissing: boolean
): Promise<Awaited<ReturnType<typeof connectChrome>>["page"]> {
  if (!urlFilter || urlFilter.trim().length === 0) {
    return defaultPage;
  }

  const normalized = urlFilter.trim();
  const byMatch = context.pages().find((candidate) => candidate.url().includes(normalized));
  if (byMatch) {
    await byMatch.bringToFront().catch(() => undefined);
    return byMatch;
  }

  if (navigateIfMissing) {
    await defaultPage.goto(normalized, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    await defaultPage.waitForTimeout(500);
  }

  return defaultPage;
}

async function run(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const command = args.command;

  if (!command) {
    writeJsonAndExit({ ok: false, error: "missing_command" });
  }

  const cdpEndpoint = process.env.CDP_ENDPOINT?.trim() || "http://localhost:9222";

  try {
    const connection = await connectChrome(cdpEndpoint);

    if (command === "navigate") {
      const targetUrl = getRequiredFlag(args, "url");
      await connection.page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      await connection.page.waitForTimeout(500);
      writeJsonAndExit({
        ok: true,
        url: connection.page.url(),
        title: await connection.page.title().catch(() => "")
      });
    }

    const urlFlag = getFlag(args, "url");
    const page = await resolvePageForCommand(connection.page, connection.context, urlFlag, true);

    if (command === "snapshot") {
      const snapshot = await getPageSnapshot(page);
      writeJsonAndExit({ ok: true, snapshot });
    }

    if (command === "fill") {
      const label = getRequiredFlag(args, "label");
      const value = getRequiredFlag(args, "value");
      const result = await fillField(page, label, value);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "dropdown") {
      const label = getRequiredFlag(args, "label");
      const searchTerms = getRepeatedFlag(args, "search");
      if (searchTerms.length === 0) {
        throw new Error("missing_required_flag:search");
      }

      const result = await fillCustomDropdown(page, label, searchTerms);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "textarea") {
      const label = getRequiredFlag(args, "label");
      const answer = getRequiredFlag(args, "answer");
      const result = await fillTextarea(page, label, answer);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "upload") {
      const filePath = getRequiredFlag(args, "file");
      const result = await uploadResume(page, filePath);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "click") {
      const directText = getRepeatedFlag(args, "text");
      const textPatterns = directText.length > 0 ? directText : args.positionals;
      if (textPatterns.length === 0) {
        throw new Error("missing_required_flag:text");
      }

      const result = await clickButton(page, textPatterns);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "screenshot") {
      const name = getRequiredFlag(args, "name");
      const result = await takeScreenshot(page, connection.context, name, "artifacts");
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "dismiss") {
      const result = await dismissOverlays(page);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "detect-blockers") {
      const result = await detectBlockers(page);
      writeJsonAndExit({ ok: true, result });
    }

    if (command === "scroll") {
      const direction = getRequiredFlag(args, "direction");
      if (
        direction !== "up" &&
        direction !== "down" &&
        direction !== "top" &&
        direction !== "bottom"
      ) {
        throw new Error("invalid_direction");
      }

      const result = await scrollPage(page, direction);
      writeJsonAndExit({ ok: true, result });
    }

    writeJsonAndExit({ ok: false, error: `unknown_command:${command}` });
  } catch (error) {
    writeJsonAndExit({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

void run();

import { google, gmail_v1 } from "googleapis";

export interface ParsedEmailContent {
  headers: Record<string, string>;
  subject: string;
  html: string;
  text: string;
  datePosted: Date;
}

export interface SWEListEmail {
  id: string;
  threadId: string;
  subject: string;
  html: string;
  text: string;
  datePosted: Date;
  snippet: string;
  headers: Record<string, string>;
}

export interface SWEListEmailQueryOptions {
  maxResults?: number;
  afterDate?: Date;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function decodeQuotedPrintable(input: string): string {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < withoutSoftBreaks.length; i += 1) {
    const char = withoutSoftBreaks[i];
    const hex = withoutSoftBreaks.slice(i + 1, i + 3);

    if (char === "=" && /^[\da-fA-F]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }

    bytes.push(char.charCodeAt(0));
  }

  return Buffer.from(bytes).toString("utf8");
}

function decodeMimeQWord(value: string): string {
  const withoutUnderscores = value.replace(/_/g, " ");
  const bytes: number[] = [];

  for (let i = 0; i < withoutUnderscores.length; i += 1) {
    const char = withoutUnderscores[i];
    const hex = withoutUnderscores.slice(i + 1, i + 3);

    if (char === "=" && /^[\da-fA-F]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }

    bytes.push(char.charCodeAt(0));
  }

  return Buffer.from(bytes).toString("utf8");
}

export function decodeMimeHeader(value: string): string {
  return value.replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, encoded: string) =>
    decodeMimeQWord(encoded)
  );
}

export function parseEmailHeaders(headersRaw: string): Record<string, string> {
  // TODO(remove after live Gmail API integration tests):
  // This parser supports raw .eml fixture files used in local tests.
  // Once tests run against real Gmail API responses, drop this .eml-specific path.
  const lines = headersRaw.split(/\r?\n/);
  const unfolded: string[] = [];

  for (const line of lines) {
    if (/^\s/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  const headers: Record<string, string> = {};

  for (const line of unfolded) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[name] = value;
  }

  return headers;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padLength)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function getPayloadHeaderMap(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const header of headers ?? []) {
    if (!header.name) {
      continue;
    }
    result[header.name.toLowerCase()] = header.value ?? "";
  }

  return result;
}

function maybeDecodeTransferEncoding(
  content: string,
  transferEncoding: string | undefined
): string {
  if (transferEncoding?.toLowerCase().includes("quoted-printable")) {
    return decodeQuotedPrintable(content);
  }
  return content;
}

function extractMessageBodies(
  part: gmail_v1.Schema$MessagePart | undefined,
  fallbackTransferEncoding?: string
): { html: string; text: string } {
  if (!part) {
    return { html: "", text: "" };
  }

  const headers = getPayloadHeaderMap(part.headers);
  const transferEncoding = headers["content-transfer-encoding"] ?? fallbackTransferEncoding;

  if (part.parts && part.parts.length > 0) {
    const children = part.parts.map((child) => extractMessageBodies(child, transferEncoding));
    const html = children.find((child) => child.html)?.html ?? "";
    const text = children.find((child) => child.text)?.text ?? "";
    return { html, text };
  }

  const decoded = part.body?.data
    ? maybeDecodeTransferEncoding(decodeBase64Url(part.body.data), transferEncoding)
    : "";

  if (part.mimeType === "text/html") {
    return { html: decoded, text: "" };
  }

  if (part.mimeType === "text/plain") {
    return { html: "", text: decoded };
  }

  if (decoded) {
    return { html: decoded, text: "" };
  }

  return { html: "", text: "" };
}

export function parseRawEmlMessage(raw: string): ParsedEmailContent {
  // TODO(remove after live Gmail API integration tests):
  // This function exists only to decode downloaded .eml samples for local integration tests.
  // Production ingestion should rely on parseGmailMessageContent() with Gmail API payloads.
  const boundaryIndex = raw.search(/\r?\n\r?\n/);
  if (boundaryIndex === -1) {
    throw new Error("Invalid EML format: missing header/body separator");
  }

  const headersRaw = raw.slice(0, boundaryIndex);
  const bodyRaw = raw.slice(boundaryIndex).replace(/^\r?\n\r?\n/, "");
  const headers = parseEmailHeaders(headersRaw);
  const contentTransferEncoding = headers["content-transfer-encoding"];

  const subject = decodeMimeHeader(headers.subject ?? "");
  const datePosted = headers.date ? new Date(headers.date) : new Date("2026-01-01T00:00:00.000Z");
  const body = maybeDecodeTransferEncoding(bodyRaw, contentTransferEncoding);
  const html = headers["content-type"]?.toLowerCase().includes("text/plain") ? "" : body;
  const text = headers["content-type"]?.toLowerCase().includes("text/plain") ? body : "";

  return { headers, subject, html, text, datePosted };
}

export function parseGmailMessageContent(message: gmail_v1.Schema$Message): SWEListEmail {
  const payloadHeaders = getPayloadHeaderMap(message.payload?.headers);
  const subject = decodeMimeHeader(payloadHeaders.subject ?? "");
  const datePosted = payloadHeaders.date
    ? new Date(payloadHeaders.date)
    : message.internalDate
      ? new Date(Number.parseInt(message.internalDate, 10))
      : new Date("2026-01-01T00:00:00.000Z");

  const { html, text } = extractMessageBodies(message.payload);

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject,
    html,
    text,
    datePosted,
    snippet: message.snippet ?? "",
    headers: payloadHeaders
  };
}

export function buildGmailClient(): gmail_v1.Gmail {
  const oauth2Client = new google.auth.OAuth2(
    getEnv("GOOGLE_CLIENT_ID"),
    getEnv("GOOGLE_CLIENT_SECRET"),
    getEnv("GOOGLE_REDIRECT_URI")
  );

  oauth2Client.setCredentials({ refresh_token: getEnv("GOOGLE_REFRESH_TOKEN") });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

function buildSWEListQuery(afterDate?: Date): string {
  const queryParts = ["from:noreply@swelist.com"];

  if (afterDate && !Number.isNaN(afterDate.getTime())) {
    const epochSeconds = Math.floor(afterDate.getTime() / 1000);
    queryParts.push(`after:${epochSeconds}`);
  }

  return queryParts.join(" ");
}

export async function getSWEListEmails(
  options: SWEListEmailQueryOptions = {}
): Promise<SWEListEmail[]> {
  const maxResults = options.maxResults ?? 25;
  const gmail = buildGmailClient();
  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: buildSWEListQuery(options.afterDate),
    maxResults
  });

  const messageIds = listResponse.data.messages ?? [];
  if (messageIds.length === 0) {
    return [];
  }

  const fullMessages = await Promise.all(
    messageIds.map(async (message) => {
      if (!message.id) {
        return null;
      }

      const full = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full"
      });

      return full.data;
    })
  );

  return fullMessages
    .filter((message): message is gmail_v1.Schema$Message => Boolean(message))
    .map((message) => parseGmailMessageContent(message));
}

export async function getResponseEmails(jobCompany: string): Promise<gmail_v1.Schema$Message[]> {
  const gmail = buildGmailClient();
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `${jobCompany} (rejected OR accepted OR interview OR application update)`,
    maxResults: 25
  });

  return response.data.messages ?? [];
}

export async function getVerificationEmails(
  portalDomain: string
): Promise<gmail_v1.Schema$Message[]> {
  const gmail = buildGmailClient();
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `from:${portalDomain} (verify OR verification OR confirm email)`,
    maxResults: 10
  });

  return response.data.messages ?? [];
}

export async function classifyEmail(
  emailBody: string
): Promise<"accepted" | "rejected" | "interview" | "other"> {
  const text = emailBody.toLowerCase();
  if (
    text.includes("unfortunately") ||
    text.includes("not moving forward") ||
    text.includes("regret")
  ) {
    return "rejected";
  }
  if (text.includes("congrat") || text.includes("offer")) {
    return "accepted";
  }
  if (text.includes("interview") || text.includes("schedule")) {
    return "interview";
  }
  return "other";
}

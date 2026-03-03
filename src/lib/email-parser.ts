import { ParsedSWEListJob } from "@/types";

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSource(subject: string): ParsedSWEListJob["source"] {
  return /internship/i.test(subject) ? "internship" : "new-grad";
}

const US_STATE_SUFFIX_PATTERN =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
const REMOTE_US_PATTERN =
  /\bremote\b.*\b(united states|u\.s\.a?\.?|usa|us)\b|\b(united states|u\.s\.a?\.?|usa|us)\b.*\bremote\b/i;

function isLikelyUSLocation(text: string): boolean {
  const value = text.toLowerCase();
  return (
    value.includes("united states") ||
    value.includes("u.s.") ||
    value.includes(" usa") ||
    REMOTE_US_PATTERN.test(text) ||
    US_STATE_SUFFIX_PATTERN.test(text)
  );
}

export function parseSWEListHtml(
  html: string,
  subject: string,
  datePosted: Date
): ParsedSWEListJob[] {
  const entries: ParsedSWEListJob[] = [];
  const source = detectSource(subject);

  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const applicationUrl = match[1]?.trim();
    const linkText = stripHtml(match[2] ?? "");

    if (!applicationUrl || !linkText || !applicationUrl.startsWith("http")) {
      continue;
    }

    const [companyRaw, roleRaw] = linkText.includes(":")
      ? linkText.split(":", 2)
      : [linkText, "Software Engineer"];
    const company = companyRaw.trim();
    const role = roleRaw.trim();

    const surrounding = html.slice(
      Math.max(0, match.index - 180),
      Math.min(html.length, match.index + 180)
    );
    const contextText = stripHtml(surrounding);
    const location = /remote/i.test(contextText) ? "Remote (US)" : "United States";

    if (!isLikelyUSLocation(contextText)) {
      continue;
    }

    entries.push({
      company,
      role,
      location,
      applicationUrl,
      source,
      datePosted
    });
  }

  return entries;
}

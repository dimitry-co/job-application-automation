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

function isLikelyUSLocation(text: string): boolean {
  const value = text.toLowerCase();
  return (
    value.includes("united states") ||
    value.includes(" usa") ||
    value.includes("u.s.") ||
    value.includes("remote") ||
    /\b[A-Z]{2}\b/.test(text)
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

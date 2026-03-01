import { describe, expect, test } from "vitest";
import {
  classifyEmail,
  decodeMimeHeader,
  decodeQuotedPrintable,
  parseRawEmlMessage
} from "@/lib/gmail";

describe("classifyEmail", () => {
  test("returns rejected for negative language", async () => {
    await expect(classifyEmail("We regret to inform you...")).resolves.toBe("rejected");
  });
});

describe("email decoding utilities", () => {
  test("decodes MIME encoded subject headers", () => {
    const encoded = "=?UTF-8?Q?=E2=9C=A8_99_New_Internships_Posted_Today?=";
    expect(decodeMimeHeader(encoded)).toBe("✨ 99 New Internships Posted Today");
  });

  test("decodes quoted-printable body text", () => {
    const encoded = "Hello=2C_world=21=0A";
    expect(decodeQuotedPrintable(encoded)).toContain("Hello,_world!");
  });

  test("parses raw .eml headers and html body", () => {
    const raw = [
      "Date: Thu, 26 Feb 2026 13:13:33 -0800 (PST)",
      "Subject: =?UTF-8?Q?=E2=9C=A8_99_New_Internships_Posted_Today?=",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<p><strong>Acme:</strong> <a href=3D"https://example.com">Intern</a></p>'
    ].join("\r\n");

    const parsed = parseRawEmlMessage(raw);
    expect(parsed.subject).toContain("Internships");
    expect(parsed.html).toContain('href="https://example.com"');
    expect(parsed.datePosted.toISOString()).toContain("2026-02-26");
  });
});

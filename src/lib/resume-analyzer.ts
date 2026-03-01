import OpenAI from "openai";
import { ResumeRecommendation } from "@/types";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

export async function analyzeResumeMatch(jobDescription: string): Promise<ResumeRecommendation> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      recommendation: /intern/i.test(jobDescription) ? "student" : "experienced",
      confidence: 0.55,
      rationale: "Fallback heuristic used because OPENAI_API_KEY is not configured."
    };
  }

  const prompt = [
    "You are selecting the stronger resume for a job application.",
    "Return strict JSON: { recommendation: 'student' | 'experienced', confidence: number, rationale: string }",
    `Job description: ${jobDescription}`
  ].join("\n");

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    input: prompt
  });

  const text = response.output_text.trim();
  try {
    const parsed = JSON.parse(text) as ResumeRecommendation;
    return parsed;
  } catch {
    return {
      recommendation: "experienced",
      confidence: 0.5,
      rationale: "Model output was not valid JSON; used conservative fallback."
    };
  }
}

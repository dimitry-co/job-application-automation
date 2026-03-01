import { analyzeResumeMatch } from "@/lib/resume-analyzer";

export interface PreparedApplication {
  summary: string;
  resumeChoice: "student" | "experienced";
  confidence: number;
}

export async function prepareApplication(jobDescription: string): Promise<PreparedApplication> {
  const recommendation = await analyzeResumeMatch(jobDescription);

  return {
    summary: `Targeted application prepared using ${recommendation.recommendation} resume.`,
    resumeChoice: recommendation.recommendation,
    confidence: recommendation.confidence
  };
}

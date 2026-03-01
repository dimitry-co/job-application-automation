export function buildFieldMappingPrompt(context: {
  jobTitle: string;
  company: string;
  profileText: string;
}): string {
  return [
    "You are analyzing a job application form screenshot.",
    "Identify fillable fields and map each field to user profile data.",
    "Return JSON only with: fieldLabel, fieldType, selectorHint, value, confidence.",
    `Job Title: ${context.jobTitle}`,
    `Company: ${context.company}`,
    `Profile:\n${context.profileText}`
  ].join("\n");
}

export function buildOpenEndedAnswerPrompt(question: string, contextSummary: string): string {
  return [
    "Answer this job application question in 40-60 words.",
    "Keep tone concise and professional.",
    `Question: ${question}`,
    `Context: ${contextSummary}`
  ].join("\n");
}

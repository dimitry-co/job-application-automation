import path from "node:path";
import { promises as fs } from "node:fs";
import { SkillContext } from "@/types";

const SKILLS_ROOT = path.resolve(process.cwd(), "skills");

export async function listSkills(): Promise<string[]> {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function loadSkill(skillName: string): Promise<string> {
  const skillPath = path.join(SKILLS_ROOT, skillName, "SKILL.md");
  return fs.readFile(skillPath, "utf8");
}

export async function executeSkill(
  skillName: string,
  context: SkillContext
): Promise<{ skillName: string; context: SkillContext; instructions: string }> {
  const instructions = await loadSkill(skillName);
  return { skillName, context, instructions };
}

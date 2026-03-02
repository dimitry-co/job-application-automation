import path from "node:path";
import { promises as fs } from "node:fs";
import { SkillContext } from "@/types";

const SKILLS_ROOT_CANDIDATES = [
  path.resolve(process.cwd(), ".agents", "skills"),
  path.resolve(process.cwd(), "skills")
];

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getSkillsRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const root of SKILLS_ROOT_CANDIDATES) {
    if (await pathExists(root)) {
      roots.push(root);
    }
  }
  return roots;
}

export async function listSkills(): Promise<string[]> {
  const roots = await getSkillsRoots();
  const skills = new Set<string>();

  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        skills.add(entry.name);
      }
    }
  }

  return Array.from(skills);
}

export async function loadSkill(skillName: string): Promise<string> {
  const roots = await getSkillsRoots();

  for (const root of roots) {
    const skillPath = path.join(root, skillName, "SKILL.md");
    if (await pathExists(skillPath)) {
      return fs.readFile(skillPath, "utf8");
    }
  }

  throw new Error(`Skill not found: ${skillName}`);
}

export async function executeSkill(
  skillName: string,
  context: SkillContext
): Promise<{ skillName: string; context: SkillContext; instructions: string }> {
  const instructions = await loadSkill(skillName);
  return { skillName, context, instructions };
}

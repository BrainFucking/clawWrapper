import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

export async function ask(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  const value = answer.trim();
  return value.length > 0 ? value : fallback;
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const label = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`${question} [${label}]: `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return defaultYes;
  }
  return normalized === "y" || normalized === "yes";
}

export function closePrompt(): void {
  rl.close();
}

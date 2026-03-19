import { runCommand } from "./exec";

export type SupportedPlatform = "macos" | "linux" | "windows";

export function detectPlatform(): SupportedPlatform {
  if (process.platform === "darwin") {
    return "macos";
  }
  if (process.platform === "win32") {
    return "windows";
  }
  return "linux";
}

export async function commandExists(command: string): Promise<boolean> {
  const checkCommand = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(checkCommand, [command]);
  return result.code === 0;
}

export function isNodeVersionSupported(): boolean {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 22;
}

export function getDefaultConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${home}/.openclaw/config.json`;
}

export function getDefaultStateDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${home}/.openclaw/state`;
}

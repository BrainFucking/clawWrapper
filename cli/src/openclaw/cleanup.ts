import { rm } from "node:fs/promises";
import { commandExists, detectPlatform } from "../utils/platform";
import { runCommand } from "../utils/exec";

export interface CleanupOptions {
  dryRun: boolean;
  purgePaths: string[];
}

export interface CleanupReport {
  steps: string[];
  warnings: string[];
  errors: string[];
}

export async function uninstallOpenClaw(options: CleanupOptions): Promise<CleanupReport> {
  const report: CleanupReport = { steps: [], warnings: [], errors: [] };
  const platform = detectPlatform();

  if (platform === "windows") {
    report.steps.push("Attempting to stop OpenClaw service on Windows.");
    await runCommand("openclaw", ["daemon", "stop"], {
      dryRun: options.dryRun,
      streamOutput: true,
    });
  } else {
    report.steps.push("Attempting to stop OpenClaw daemon.");
    await runCommand("openclaw", ["daemon", "stop"], {
      dryRun: options.dryRun,
      streamOutput: true,
    });
  }

  if (await commandExists("npm")) {
    const uninstallResult = await runCommand("npm", ["uninstall", "-g", "openclaw"], {
      dryRun: options.dryRun,
      streamOutput: true,
    });
    if (uninstallResult.code === 0) {
      report.steps.push("Removed npm global package openclaw.");
    } else {
      report.warnings.push("Failed to remove openclaw via npm uninstall -g.");
    }
  } else {
    report.warnings.push("npm not found; skipped npm global uninstall.");
  }

  for (const targetPath of options.purgePaths) {
    if (!targetPath.trim()) {
      continue;
    }
    if (options.dryRun) {
      report.steps.push(`[dry-run] Would remove ${targetPath}`);
      continue;
    }
    try {
      await rm(targetPath, { recursive: true, force: true });
      report.steps.push(`Removed ${targetPath}`);
    } catch (error) {
      report.warnings.push(`Failed to remove ${targetPath}: ${String(error)}`);
    }
  }

  return report;
}

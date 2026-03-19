import { uninstallOpenClaw } from "../openclaw/cleanup";
import { getDefaultConfigPath, getDefaultStateDir } from "../utils/platform";
import { closePrompt, confirm } from "../utils/prompt";

export interface UninstallCommandOptions {
  dryRun: boolean;
  purgeAll: boolean;
}

export async function runUninstallCommand(options: UninstallCommandOptions): Promise<number> {
  const pathsToPurge: string[] = [];
  const defaultPaths = [
    process.env.OPENCLAW_HOME ?? "",
    process.env.OPENCLAW_STATE_DIR ?? getDefaultStateDir(),
    process.env.OPENCLAW_CONFIG_PATH ?? getDefaultConfigPath(),
  ];

  if (options.purgeAll) {
    pathsToPurge.push(...defaultPaths);
  } else {
    const shouldPurge = await confirm(
      "Also remove OpenClaw config/state paths (OPENCLAW_HOME/OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH)?",
      false,
    );
    if (shouldPurge) {
      pathsToPurge.push(...defaultPaths);
    }
  }
  closePrompt();

  const report = await uninstallOpenClaw({
    dryRun: options.dryRun,
    purgePaths: pathsToPurge,
  });

  for (const step of report.steps) {
    console.log(`- ${step}`);
  }
  for (const warning of report.warnings) {
    console.warn(`! ${warning}`);
  }
  for (const error of report.errors) {
    console.error(`x ${error}`);
  }

  console.log("Verification: run `which openclaw` and `openclaw --help` (should fail if removed).");
  return report.errors.length > 0 ? 1 : 0;
}

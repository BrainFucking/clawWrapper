import { installOpenClaw, type InstallMethod, verifyOpenClaw } from "../openclaw/installers";

export interface InstallCommandOptions {
  dryRun: boolean;
  noOnboard: boolean;
  method: InstallMethod;
}

export async function runInstallCommand(options: InstallCommandOptions): Promise<number> {
  const installReport = await installOpenClaw({
    dryRun: options.dryRun,
    method: options.method,
    runOnboard: !options.noOnboard,
  });

  for (const step of installReport.steps) {
    console.log(`- ${step}`);
  }
  for (const warning of installReport.warnings) {
    console.warn(`! ${warning}`);
  }
  for (const error of installReport.errors) {
    console.error(`x ${error}`);
  }
  if (installReport.errors.length > 0) {
    return 1;
  }

  const verify = await verifyOpenClaw(options.dryRun);
  for (const step of verify.steps) {
    console.log(`- ${step}`);
  }
  for (const warning of verify.warnings) {
    console.warn(`! ${warning}`);
  }
  for (const error of verify.errors) {
    console.error(`x ${error}`);
  }
  return verify.errors.length > 0 ? 1 : 0;
}

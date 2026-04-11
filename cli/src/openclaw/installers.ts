import { commandExists, isNodeVersionSupported } from "../utils/platform";
import { runCommand } from "../utils/exec";
import { mkdir } from "node:fs/promises";
import {
  OPENCLAW_PINNED_REF,
  ensureStableOpenClawSource,
  preparePinnedOpenClawSource,
  verifyOpenClawSourcePreflight,
} from "./source";
import {
  DEFAULT_NPM_REGISTRY,
  prepareGithubTarballsForInstall,
  withMirrorRegistry,
} from "./githubTarballs";

export type InstallMethod = "auto" | "installer" | "npm" | "local";

export interface InstallOptions {
  method: InstallMethod;
  dryRun: boolean;
  runOnboard: boolean;
}

export interface InstallReport {
  steps: string[];
  warnings: string[];
  errors: string[];
}

async function ensurePnpmAvailable(dryRun: boolean): Promise<boolean> {
  if (await commandExists("pnpm")) {
    return true;
  }
  const hasCorepack = await commandExists("corepack");
  if (hasCorepack) {
    const enable = await runCommand("corepack", ["enable"], { dryRun, streamOutput: true });
    const activate = await runCommand("corepack", ["prepare", "pnpm@latest", "--activate"], {
      dryRun,
      streamOutput: true,
    });
    if (enable.code === 0 && activate.code === 0 && (dryRun || (await commandExists("pnpm")))) {
      return true;
    }
  }
  if (await commandExists("npm")) {
    const install = await runCommand("npm", ["install", "-g", "pnpm"], {
      dryRun,
      streamOutput: true,
      env: withMirrorRegistry(),
    });
    if (install.code === 0 && (dryRun || (await commandExists("pnpm")))) {
      return true;
    }
  }
  return false;
}

async function ensurePnpmGlobalBinEnv(): Promise<NodeJS.ProcessEnv> {
  const env = withMirrorRegistry();
  const home = process.env.HOME ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  let pnpmHome = (process.env.PNPM_HOME ?? "").trim();
  if (!pnpmHome) {
    if (process.platform === "darwin" && home) {
      pnpmHome = `${home}/Library/pnpm`;
    } else if (process.platform === "win32" && localAppData) {
      pnpmHome = `${localAppData}\\pnpm`;
    } else if (home) {
      pnpmHome = `${home}/.local/share/pnpm`;
    }
  }
  if (!pnpmHome) {
    return env;
  }
  await mkdir(pnpmHome, { recursive: true });
  env.PNPM_HOME = pnpmHome;
  env.PATH = process.platform === "win32"
    ? `${pnpmHome};${process.env.PATH ?? ""}`
    : `${pnpmHome}:${process.env.PATH ?? ""}`;
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await runCommand(pnpmCmd, ["config", "set", "global-bin-dir", pnpmHome], { env });
  return env;
}

export async function installOpenClaw(options: InstallOptions): Promise<InstallReport> {
  const report: InstallReport = { steps: [], warnings: [], errors: [] };
  const installEnv = await ensurePnpmGlobalBinEnv();
  report.steps.push(`Using npm mirror registry: ${DEFAULT_NPM_REGISTRY}`);

  if (!isNodeVersionSupported()) {
    report.warnings.push(
      `Node ${process.versions.node} detected. OpenClaw docs recommend Node 22+.`,
    );
  }

  const stableSource = options.dryRun
    ? { ok: true, sourceDir: "vendor/openclaw", copied: false }
    : await ensureStableOpenClawSource();
  if (!stableSource.ok) {
    report.errors.push(stableSource.message ?? "Failed to prepare stable OpenClaw source directory.");
    return report;
  }
  const sourceDir = stableSource.sourceDir;

  if (!options.dryRun) {
    const sourcePrepared = await preparePinnedOpenClawSource(sourceDir, OPENCLAW_PINNED_REF);
    if (!sourcePrepared.ok) {
      report.errors.push(
        `OpenClaw source preparation failed (${OPENCLAW_PINNED_REF}): ${sourcePrepared.message ?? "unknown error"}`,
      );
      return report;
    }
    if (sourcePrepared.fallbackUsed) {
      report.warnings.push(
        `Pinned ref ${OPENCLAW_PINNED_REF} not found; using fallback stable ref ${sourcePrepared.resolvedRef}.`,
      );
    }
    const missingFiles = await verifyOpenClawSourcePreflight(sourceDir);
    if (missingFiles.length > 0) {
      report.errors.push(
        `OpenClaw source preflight failed. Missing files in ${sourceDir}: ${missingFiles.join(", ")}`,
      );
      return report;
    }
  }

  if (!(await ensurePnpmAvailable(options.dryRun))) {
    report.errors.push("pnpm is required but could not be prepared (corepack/npm fallback failed).");
    return report;
  }
  if (options.method !== "local" && options.method !== "auto") {
    report.warnings.push(`Install method '${options.method}' is deprecated; using local source install.`);
  }

  if (!options.dryRun) {
    const githubTarballs = await prepareGithubTarballsForInstall(sourceDir);
    if (!githubTarballs.ok) {
      report.errors.push(githubTarballs.error ?? "GitHub tarball bundle preparation failed.");
      return report;
    }
    for (const file of githubTarballs.files) {
      const seed = await runCommand("pnpm", ["store", "add", file], {
        cwd: sourceDir,
        dryRun: options.dryRun,
        streamOutput: true,
        env: installEnv,
      });
      if (seed.code !== 0) {
        report.errors.push(`Failed to seed GitHub tarball into pnpm store: ${file}`);
        return report;
      }
    }
  }

  for (const step of [
    { title: "Installing OpenClaw dependencies via pnpm.", args: ["install"] },
    { title: "Building OpenClaw UI via pnpm.", args: ["ui:build"] },
    { title: "Building OpenClaw core via pnpm.", args: ["build"] },
    { title: "Linking OpenClaw globally via pnpm.", args: ["link", "--global"] },
  ]) {
    report.steps.push(step.title);
    const result = await runCommand("pnpm", step.args, {
      cwd: sourceDir,
      dryRun: options.dryRun,
      streamOutput: true,
      env: installEnv,
    });
    if (result.code !== 0) {
      const stderrTail = result.stderr.trim().split(/\r?\n/).slice(-25).join("\n");
      const stdoutTail = result.stdout.trim().split(/\r?\n/).slice(-25).join("\n");
      report.errors.push(`${step.title} failed.`);
      if (stderrTail) {
        report.errors.push(`stderr tail:\n${stderrTail}`);
      } else if (stdoutTail) {
        report.errors.push(`stdout tail:\n${stdoutTail}`);
      }
      if (step.args.includes("ui:build")) {
        report.errors.push(
          `OpenClaw UI build failed on current source ref. Ensure vendor/openclaw is pinned to ${OPENCLAW_PINNED_REF}.`,
        );
      }
      return report;
    }
  }

  if (options.runOnboard) {
    report.steps.push("Running OpenClaw onboarding.");
    const onboardResult = await runCommand(
      "openclaw",
      ["onboard", "--install-daemon"],
      { dryRun: options.dryRun, streamOutput: true },
    );
    if (onboardResult.code !== 0) {
      report.warnings.push("Onboarding command failed. You can run it manually later.");
    }
  }

  return report;
}

export async function verifyOpenClaw(dryRun: boolean): Promise<InstallReport> {
  const report: InstallReport = { steps: [], warnings: [], errors: [] };
  const hasOpenClaw = await commandExists("openclaw");
  if (!hasOpenClaw && !dryRun) {
    report.errors.push("`openclaw` is not available in PATH after installation.");
    report.warnings.push(
      "If npm global bin is not in PATH, add `$(npm prefix -g)/bin` to your shell startup file.",
    );
    return report;
  }

  for (const cmd of [
    ["doctor"],
    ["status"],
  ]) {
    const result = await runCommand("openclaw", cmd, { dryRun, streamOutput: true });
    if (result.code === 0) {
      report.steps.push(`openclaw ${cmd.join(" ")} completed.`);
    } else {
      report.warnings.push(`openclaw ${cmd.join(" ")} failed.`);
    }
  }

  return report;
}

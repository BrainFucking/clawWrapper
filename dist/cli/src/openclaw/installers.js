"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installOpenClaw = installOpenClaw;
exports.verifyOpenClaw = verifyOpenClaw;
const platform_1 = require("../utils/platform");
const exec_1 = require("../utils/exec");
const promises_1 = require("node:fs/promises");
const source_1 = require("./source");
const githubTarballs_1 = require("./githubTarballs");
async function ensurePnpmAvailable(dryRun) {
    if (await (0, platform_1.commandExists)("pnpm")) {
        return true;
    }
    const hasCorepack = await (0, platform_1.commandExists)("corepack");
    if (hasCorepack) {
        const enable = await (0, exec_1.runCommand)("corepack", ["enable"], { dryRun, streamOutput: true });
        const activate = await (0, exec_1.runCommand)("corepack", ["prepare", "pnpm@latest", "--activate"], {
            dryRun,
            streamOutput: true,
        });
        if (enable.code === 0 && activate.code === 0 && (dryRun || (await (0, platform_1.commandExists)("pnpm")))) {
            return true;
        }
    }
    if (await (0, platform_1.commandExists)("npm")) {
        const install = await (0, exec_1.runCommand)("npm", ["install", "-g", "pnpm"], {
            dryRun,
            streamOutput: true,
            env: (0, githubTarballs_1.withMirrorRegistry)(),
        });
        if (install.code === 0 && (dryRun || (await (0, platform_1.commandExists)("pnpm")))) {
            return true;
        }
    }
    return false;
}
async function ensurePnpmGlobalBinEnv() {
    const env = (0, githubTarballs_1.withMirrorRegistry)();
    const home = process.env.HOME ?? "";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    let pnpmHome = (process.env.PNPM_HOME ?? "").trim();
    if (!pnpmHome) {
        if (process.platform === "darwin" && home) {
            pnpmHome = `${home}/Library/pnpm`;
        }
        else if (process.platform === "win32" && localAppData) {
            pnpmHome = `${localAppData}\\pnpm`;
        }
        else if (home) {
            pnpmHome = `${home}/.local/share/pnpm`;
        }
    }
    if (!pnpmHome) {
        return env;
    }
    await (0, promises_1.mkdir)(pnpmHome, { recursive: true });
    env.PNPM_HOME = pnpmHome;
    env.PATH = process.platform === "win32"
        ? `${pnpmHome};${process.env.PATH ?? ""}`
        : `${pnpmHome}:${process.env.PATH ?? ""}`;
    const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await (0, exec_1.runCommand)(pnpmCmd, ["config", "set", "global-bin-dir", pnpmHome], { env });
    return env;
}
async function installOpenClaw(options) {
    const report = { steps: [], warnings: [], errors: [] };
    const installEnv = await ensurePnpmGlobalBinEnv();
    report.steps.push(`Using npm mirror registry: ${githubTarballs_1.DEFAULT_NPM_REGISTRY}`);
    if (!(0, platform_1.isNodeVersionSupported)()) {
        report.warnings.push(`Node ${process.versions.node} detected. OpenClaw docs recommend Node 22+.`);
    }
    if (!options.dryRun) {
        const sourcePrepared = await (0, source_1.preparePinnedOpenClawSource)(source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE, source_1.OPENCLAW_PINNED_REF);
        if (!sourcePrepared.ok) {
            report.errors.push(`OpenClaw source preparation failed (${source_1.OPENCLAW_PINNED_REF}): ${sourcePrepared.message ?? "unknown error"}`);
            return report;
        }
        if (sourcePrepared.fallbackUsed) {
            report.warnings.push(`Pinned ref ${source_1.OPENCLAW_PINNED_REF} not found; using fallback stable ref ${sourcePrepared.resolvedRef}.`);
        }
        const missingFiles = await (0, source_1.verifyOpenClawSourcePreflight)(source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE);
        if (missingFiles.length > 0) {
            report.errors.push(`OpenClaw source preflight failed. Missing files in ${source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE}: ${missingFiles.join(", ")}`);
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
        const githubTarballs = await (0, githubTarballs_1.prepareGithubTarballsForInstall)(source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE);
        if (!githubTarballs.ok) {
            report.errors.push(githubTarballs.error ?? "GitHub tarball bundle preparation failed.");
            return report;
        }
        for (const file of githubTarballs.files) {
            const seed = await (0, exec_1.runCommand)("pnpm", ["store", "add", file], {
                cwd: source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE,
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
        const result = await (0, exec_1.runCommand)("pnpm", step.args, {
            cwd: source_1.LOCAL_OPENCLAW_SOURCE_ABSOLUTE,
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
            }
            else if (stdoutTail) {
                report.errors.push(`stdout tail:\n${stdoutTail}`);
            }
            if (step.args.includes("ui:build")) {
                report.errors.push(`OpenClaw UI build failed on current source ref. Ensure vendor/openclaw is pinned to ${source_1.OPENCLAW_PINNED_REF}.`);
            }
            return report;
        }
    }
    if (options.runOnboard) {
        report.steps.push("Running OpenClaw onboarding.");
        const onboardResult = await (0, exec_1.runCommand)("openclaw", ["onboard", "--install-daemon"], { dryRun: options.dryRun, streamOutput: true });
        if (onboardResult.code !== 0) {
            report.warnings.push("Onboarding command failed. You can run it manually later.");
        }
    }
    return report;
}
async function verifyOpenClaw(dryRun) {
    const report = { steps: [], warnings: [], errors: [] };
    const hasOpenClaw = await (0, platform_1.commandExists)("openclaw");
    if (!hasOpenClaw && !dryRun) {
        report.errors.push("`openclaw` is not available in PATH after installation.");
        report.warnings.push("If npm global bin is not in PATH, add `$(npm prefix -g)/bin` to your shell startup file.");
        return report;
    }
    for (const cmd of [
        ["doctor"],
        ["status"],
    ]) {
        const result = await (0, exec_1.runCommand)("openclaw", cmd, { dryRun, streamOutput: true });
        if (result.code === 0) {
            report.steps.push(`openclaw ${cmd.join(" ")} completed.`);
        }
        else {
            report.warnings.push(`openclaw ${cmd.join(" ")} failed.`);
        }
    }
    return report;
}

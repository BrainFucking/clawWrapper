"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uninstallOpenClaw = uninstallOpenClaw;
const promises_1 = require("node:fs/promises");
const platform_1 = require("../utils/platform");
const exec_1 = require("../utils/exec");
async function uninstallOpenClaw(options) {
    const report = { steps: [], warnings: [], errors: [] };
    const platform = (0, platform_1.detectPlatform)();
    if (platform === "windows") {
        report.steps.push("Attempting to stop OpenClaw service on Windows.");
        await (0, exec_1.runCommand)("openclaw", ["daemon", "stop"], {
            dryRun: options.dryRun,
            streamOutput: true,
        });
    }
    else {
        report.steps.push("Attempting to stop OpenClaw daemon.");
        await (0, exec_1.runCommand)("openclaw", ["daemon", "stop"], {
            dryRun: options.dryRun,
            streamOutput: true,
        });
    }
    if (await (0, platform_1.commandExists)("npm")) {
        const uninstallResult = await (0, exec_1.runCommand)("npm", ["uninstall", "-g", "openclaw"], {
            dryRun: options.dryRun,
            streamOutput: true,
        });
        if (uninstallResult.code === 0) {
            report.steps.push("Removed npm global package openclaw.");
        }
        else {
            report.warnings.push("Failed to remove openclaw via npm uninstall -g.");
        }
    }
    else {
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
            await (0, promises_1.rm)(targetPath, { recursive: true, force: true });
            report.steps.push(`Removed ${targetPath}`);
        }
        catch (error) {
            report.warnings.push(`Failed to remove ${targetPath}: ${String(error)}`);
        }
    }
    return report;
}

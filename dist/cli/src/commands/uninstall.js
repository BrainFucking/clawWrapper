"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUninstallCommand = runUninstallCommand;
const cleanup_1 = require("../openclaw/cleanup");
const platform_1 = require("../utils/platform");
const prompt_1 = require("../utils/prompt");
async function runUninstallCommand(options) {
    const pathsToPurge = [];
    const defaultPaths = [
        process.env.OPENCLAW_HOME ?? "",
        process.env.OPENCLAW_STATE_DIR ?? (0, platform_1.getDefaultStateDir)(),
        process.env.OPENCLAW_CONFIG_PATH ?? (0, platform_1.getDefaultConfigPath)(),
    ];
    if (options.purgeAll) {
        pathsToPurge.push(...defaultPaths);
    }
    else {
        const shouldPurge = await (0, prompt_1.confirm)("Also remove OpenClaw config/state paths (OPENCLAW_HOME/OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH)?", false);
        if (shouldPurge) {
            pathsToPurge.push(...defaultPaths);
        }
    }
    (0, prompt_1.closePrompt)();
    const report = await (0, cleanup_1.uninstallOpenClaw)({
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

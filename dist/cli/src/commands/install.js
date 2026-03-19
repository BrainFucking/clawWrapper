"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInstallCommand = runInstallCommand;
const installers_1 = require("../openclaw/installers");
async function runInstallCommand(options) {
    const installReport = await (0, installers_1.installOpenClaw)({
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
    const verify = await (0, installers_1.verifyOpenClaw)(options.dryRun);
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

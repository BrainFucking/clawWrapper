#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const configure_1 = require("./commands/configure");
const configureUi_1 = require("./commands/configureUi");
const feishuSetup_1 = require("./commands/feishuSetup");
const install_1 = require("./commands/install");
const uninstall_1 = require("./commands/uninstall");
function parseArgs(argv) {
    const [command = "help", ...rest] = argv;
    const flags = {};
    for (let i = 0; i < rest.length; i += 1) {
        const token = rest[i];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const next = rest[i + 1];
        if (!next || next.startsWith("--")) {
            flags[key] = true;
            continue;
        }
        flags[key] = next;
        i += 1;
    }
    return { command, flags };
}
function printHelp() {
    console.log(`
claw-wrapper - OpenClaw installer toolkit

Usage:
  claw-wrapper install [--method auto|local] [--dry-run] [--no-onboard]
  claw-wrapper feishu:setup [--bot-name "Claw Assistant"] [--output ./.feishu-bot.json] [--headless]
  claw-wrapper configure [--config <path>] [--env-out <path>] [--dry-run]
  claw-wrapper configure:ui [--config <path>] [--env-out <path>] [--host 127.0.0.1] [--port 18791] [--no-open]
  claw-wrapper manager:ui [--config <path>] [--env-out <path>] [--host 127.0.0.1] [--port 18791] [--no-open]
  claw-wrapper uninstall [--purge-all] [--dry-run]
`);
}
async function main() {
    const { command, flags } = parseArgs(process.argv.slice(2));
    let exitCode = 0;
    switch (command) {
        case "install":
            exitCode = await (0, install_1.runInstallCommand)({
                dryRun: Boolean(flags["dry-run"]),
                noOnboard: Boolean(flags["no-onboard"]),
                method: flags.method ?? "auto",
            });
            break;
        case "feishu:setup":
            exitCode = await (0, feishuSetup_1.runFeishuSetupCommand)({
                botName: flags["bot-name"] ?? "Claw Assistant",
                outputPath: flags.output ?? "./.feishu-bot.json",
                headless: Boolean(flags.headless),
            });
            break;
        case "configure":
            exitCode = await (0, configure_1.runConfigureCommand)({
                dryRun: Boolean(flags["dry-run"]),
                configPath: flags.config,
                envOut: flags["env-out"],
            });
            break;
        case "configure:ui":
        case "manager:ui":
            exitCode = await (0, configureUi_1.runConfigureUiCommand)({
                configPath: flags.config,
                envOut: flags["env-out"],
                host: flags.host,
                port: flags.port ? Number.parseInt(flags.port, 10) : undefined,
                noOpen: Boolean(flags["no-open"]),
            });
            break;
        case "uninstall":
            exitCode = await (0, uninstall_1.runUninstallCommand)({
                dryRun: Boolean(flags["dry-run"]),
                purgeAll: Boolean(flags["purge-all"]),
            });
            break;
        default:
            printHelp();
            exitCode = 0;
    }
    process.exit(exitCode);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});

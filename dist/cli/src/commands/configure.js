"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConfigureCommand = runConfigureCommand;
const promises_1 = require("node:fs/promises");
const config_1 = require("../openclaw/config");
const platform_1 = require("../utils/platform");
const prompt_1 = require("../utils/prompt");
async function runConfigureCommand(options) {
    const configPath = options.configPath ?? (0, platform_1.getDefaultConfigPath)();
    const existing = await (0, config_1.loadConfig)(configPath);
    const openclawHome = await (0, prompt_1.ask)("OpenClaw home directory", existing.openclaw.home ?? "");
    const stateDir = await (0, prompt_1.ask)("OpenClaw state directory", existing.openclaw.stateDir ?? (0, platform_1.getDefaultStateDir)());
    const appId = await (0, prompt_1.ask)("Feishu App ID", existing.feishu.appId);
    const appSecret = await (0, prompt_1.ask)("Feishu App Secret", existing.feishu.appSecret);
    const botName = await (0, prompt_1.ask)("Feishu bot name", existing.feishu.botName);
    const webhookUrl = await (0, prompt_1.ask)("Feishu webhook URL", existing.feishu.webhookUrl);
    const config = {
        openclaw: {
            home: openclawHome,
            stateDir,
            configPath,
        },
        models: existing.models,
        channels: {
            ...existing.channels,
            feishu: {
                ...existing.channels.feishu,
                enabled: true,
                appId,
                appSecret,
                botName,
                webhookUrl,
            },
        },
        feishu: {
            appId,
            appSecret,
            botName,
            webhookUrl,
        },
    };
    const errors = (0, config_1.validateConfig)(config);
    if (errors.length > 0) {
        (0, prompt_1.closePrompt)();
        for (const error of errors) {
            console.error(`x ${error}`);
        }
        return 1;
    }
    console.log("\nConfig preview:\n");
    console.log(JSON.stringify(config, null, 2));
    const shouldWrite = await (0, prompt_1.confirm)("Write this configuration to disk?", true);
    (0, prompt_1.closePrompt)();
    if (!shouldWrite) {
        console.log("Configuration canceled by user.");
        return 0;
    }
    if (options.dryRun) {
        console.log(`[dry-run] Would write config to ${configPath}`);
        if (options.envOut) {
            console.log(`[dry-run] Would write env file to ${options.envOut}`);
        }
        return 0;
    }
    await (0, config_1.saveConfig)(configPath, config);
    console.log(`Saved config at ${configPath}`);
    if (options.envOut) {
        await (0, promises_1.writeFile)(options.envOut, (0, config_1.toEnv)(config), "utf8");
        console.log(`Saved env file at ${options.envOut}`);
    }
    console.log("Next checks: `openclaw doctor` and `openclaw status`.");
    return 0;
}

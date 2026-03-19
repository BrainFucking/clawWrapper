import { writeFile } from "node:fs/promises";
import { saveConfig, toEnv, validateConfig, loadConfig } from "../openclaw/config";
import { getDefaultConfigPath, getDefaultStateDir } from "../utils/platform";
import { ask, closePrompt, confirm } from "../utils/prompt";

export interface ConfigureCommandOptions {
  dryRun: boolean;
  configPath?: string;
  envOut?: string;
}

export async function runConfigureCommand(options: ConfigureCommandOptions): Promise<number> {
  const configPath = options.configPath ?? getDefaultConfigPath();
  const existing = await loadConfig(configPath);

  const openclawHome = await ask("OpenClaw home directory", existing.openclaw.home ?? "");
  const stateDir = await ask("OpenClaw state directory", existing.openclaw.stateDir ?? getDefaultStateDir());
  const appId = await ask("Feishu App ID", existing.feishu.appId);
  const appSecret = await ask("Feishu App Secret", existing.feishu.appSecret);
  const botName = await ask("Feishu bot name", existing.feishu.botName);
  const webhookUrl = await ask("Feishu webhook URL", existing.feishu.webhookUrl);

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

  const errors = validateConfig(config);
  if (errors.length > 0) {
    closePrompt();
    for (const error of errors) {
      console.error(`x ${error}`);
    }
    return 1;
  }

  console.log("\nConfig preview:\n");
  console.log(JSON.stringify(config, null, 2));

  const shouldWrite = await confirm("Write this configuration to disk?", true);
  closePrompt();
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

  await saveConfig(configPath, config);
  console.log(`Saved config at ${configPath}`);
  if (options.envOut) {
    await writeFile(options.envOut, toEnv(config), "utf8");
    console.log(`Saved env file at ${options.envOut}`);
  }

  console.log("Next checks: `openclaw doctor` and `openclaw status`.");
  return 0;
}

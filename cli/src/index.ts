#!/usr/bin/env node
import { runConfigureCommand } from "./commands/configure";
import { runConfigureUiCommand } from "./commands/configureUi";
import { runFeishuSetupCommand } from "./commands/feishuSetup";
import { runInstallCommand } from "./commands/install";
import { runUninstallCommand } from "./commands/uninstall";

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
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

function printHelp(): void {
  console.log(`
claw-wrapper - OpenClaw installer toolkit

Usage:
  claw-wrapper install [--method auto|local] [--dry-run] [--no-onboard]
  claw-wrapper feishu:setup [--bot-name "Claw Assistant"] [--output ./.feishu-bot.json] [--headless] [--engine v1|v2] [--resume-run-id <id>] [--secret-store memory|file] [--webhook-probe]
  claw-wrapper configure [--config <path>] [--env-out <path>] [--dry-run]
  claw-wrapper configure:ui [--config <path>] [--env-out <path>] [--host 127.0.0.1] [--port 18791] [--no-open]
  claw-wrapper manager:ui [--config <path>] [--env-out <path>] [--host 127.0.0.1] [--port 18791] [--no-open]
  claw-wrapper uninstall [--purge-all] [--dry-run]
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  let exitCode = 0;
  switch (command) {
    case "install":
      exitCode = await runInstallCommand({
        dryRun: Boolean(flags["dry-run"]),
        noOnboard: Boolean(flags["no-onboard"]),
        method: (flags.method as "auto" | "installer" | "npm" | "local") ?? "auto",
      });
      break;
    case "feishu:setup":
      exitCode = await runFeishuSetupCommand({
        botName: (flags["bot-name"] as string) ?? "Claw Assistant",
        outputPath: (flags.output as string) ?? "./.feishu-bot.json",
        headless: Boolean(flags.headless),
        engine: ((flags.engine as string) === "v2" ? "v2" : "v1") as "v1" | "v2",
        resumeRunId: flags["resume-run-id"] as string | undefined,
        secretStore: ((flags["secret-store"] as string) === "file" ? "file" : "memory") as
          | "memory"
          | "file",
        webhookProbe: Boolean(flags["webhook-probe"]),
      });
      break;
    case "configure":
      exitCode = await runConfigureCommand({
        dryRun: Boolean(flags["dry-run"]),
        configPath: flags.config as string | undefined,
        envOut: flags["env-out"] as string | undefined,
      });
      break;
    case "configure:ui":
    case "manager:ui":
      exitCode = await runConfigureUiCommand({
        configPath: flags.config as string | undefined,
        envOut: flags["env-out"] as string | undefined,
        host: flags.host as string | undefined,
        port: flags.port ? Number.parseInt(flags.port as string, 10) : undefined,
        noOpen: Boolean(flags["no-open"]),
      });
      break;
    case "uninstall":
      exitCode = await runUninstallCommand({
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

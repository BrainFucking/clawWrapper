import path from "node:path";
import os from "node:os";
import { runOneThingApiKeySetup } from "./setupApiKey";

function readArg(name: string): string | undefined {
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx < 0) {
    return undefined;
  }
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const outputPath =
    readArg("--output") ?? path.join(os.homedir(), ".openclaw", "onething-setup-result.json");
  const headless = (readArg("--headless") ?? "false").toLowerCase() === "true";
  const result = await runOneThingApiKeySetup({
    outputPath,
    headless,
  });
  console.log(`[onething-auto-setup] output=${result.outputPath}`);
  console.log(`[onething-auto-setup] captured.apiKey=${result.captured.apiKey ? "(captured)" : "(empty)"}`);
  console.log(`[onething-auto-setup] steps:\n- ${result.steps.join("\n- ")}`);
}

void main().catch((error) => {
  console.error(`[onething-auto-setup] failed: ${String(error)}`);
  process.exit(1);
});

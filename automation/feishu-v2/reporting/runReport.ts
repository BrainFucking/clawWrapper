import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupResult } from "../types";

export async function writeRunReport(runsDir: string, result: SetupResult): Promise<{ reportPath: string; summaryPath: string }> {
  const runDir = path.join(runsDir, result.runId);
  await mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const reportPath = path.join(runDir, "report.json");
  const summaryPath = path.join(runDir, "summary.txt");

  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const summary = [
    `Run: ${result.runId}`,
    `Status: ${result.status}`,
    `App ID: ${result.captured.appId || "(empty)"}`,
    `Secret Ref: ${result.captured.secretRef || "(none)"}`,
    `Webhook: ${result.captured.webhookUrl || "(empty)"}`,
    `Token check: ${result.verification.tokenCheck}`,
    `Webhook probe: ${result.verification.webhookProbe}`,
    result.nextAction ? `Next action: ${result.nextAction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(summaryPath, `${summary}\n`, "utf8");

  return { reportPath, summaryPath };
}


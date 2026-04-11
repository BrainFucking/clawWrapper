"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeRunReport = writeRunReport;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function writeRunReport(runsDir, result) {
    const runDir = node_path_1.default.join(runsDir, result.runId);
    await (0, promises_1.mkdir)(node_path_1.default.join(runDir, "artifacts"), { recursive: true });
    const reportPath = node_path_1.default.join(runDir, "report.json");
    const summaryPath = node_path_1.default.join(runDir, "summary.txt");
    await (0, promises_1.writeFile)(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
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
    await (0, promises_1.writeFile)(summaryPath, `${summary}\n`, "utf8");
    return { reportPath, summaryPath };
}

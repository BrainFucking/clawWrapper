"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const setupBot_1 = require("./setupBot");
function readArg(name) {
    const idx = process.argv.findIndex((arg) => arg === name);
    if (idx < 0) {
        return undefined;
    }
    return process.argv[idx + 1];
}
async function main() {
    const botName = readArg("--bot-name") ?? "OpenClaw 助手";
    const outputPath = readArg("--output") ?? node_path_1.default.join(node_os_1.default.homedir(), ".openclaw", "feishu-setup-result.json");
    const headless = (readArg("--headless") ?? "false").toLowerCase() === "true";
    const result = await (0, setupBot_1.runGuidedFeishuSetup)({
        botName,
        outputPath,
        headless,
    });
    console.log(`[feishu-auto-setup] output=${result.outputPath}`);
    console.log(`[feishu-auto-setup] captured.appId=${result.captured.appId || "(empty)"}`);
    console.log(`[feishu-auto-setup] steps:\n- ${result.steps.join("\n- ")}`);
}
void main().catch((error) => {
    console.error(`[feishu-auto-setup] failed: ${String(error)}`);
    process.exit(1);
});

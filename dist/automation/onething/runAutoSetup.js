"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const setupApiKey_1 = require("./setupApiKey");
function readArg(name) {
    const idx = process.argv.findIndex((arg) => arg === name);
    if (idx < 0) {
        return undefined;
    }
    return process.argv[idx + 1];
}
async function main() {
    const outputPath = readArg("--output") ?? node_path_1.default.join(node_os_1.default.homedir(), ".openclaw", "onething-setup-result.json");
    const headless = (readArg("--headless") ?? "false").toLowerCase() === "true";
    const result = await (0, setupApiKey_1.runOneThingApiKeySetup)({
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

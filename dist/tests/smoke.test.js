"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("../cli/src/openclaw/config");
async function testConfigValidation() {
    const badConfig = {
        openclaw: {},
        models: {
            provider: "openai",
            baseUrl: "",
            apiKeyEnv: "OPENAI_API_KEY",
            defaultModel: "",
            dailyLimit: "unlimited",
            list: [],
        },
        channels: {
            feishu: {
                enabled: true,
                appId: "",
                appSecret: "",
                botName: "bot",
                webhookUrl: "",
            },
            qq: {
                enabled: false,
                botId: "",
                token: "",
            },
            wecom: {
                enabled: false,
                corpId: "",
                agentId: "",
                secret: "",
            },
        },
        feishu: { appId: "", appSecret: "", botName: "bot", webhookUrl: "" },
    };
    const errors = (0, config_1.validateConfig)(badConfig);
    strict_1.default.equal(errors.length, 3, "expected three validation errors");
}
async function testSaveAndEnv() {
    const tempDir = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "claw-wrapper-test-"));
    const configPath = node_path_1.default.join(tempDir, "config.json");
    const config = {
        openclaw: {
            home: "/tmp/openclaw",
            stateDir: "/tmp/openclaw/state",
            configPath,
        },
        models: {
            provider: "openai",
            baseUrl: "https://api.example.com",
            apiKeyEnv: "OPENAI_API_KEY",
            defaultModel: "gpt-5-mini",
            dailyLimit: "10k",
            list: [
                {
                    id: "gpt-5-mini",
                    name: "GPT-5 Mini",
                    contextWindow: 200000,
                    maxTokens: 8192,
                    reasoning: false,
                },
            ],
        },
        channels: {
            feishu: {
                enabled: true,
                appId: "cli_123",
                appSecret: "secret_123",
                botName: "Claw Assistant",
                webhookUrl: "https://example.com/hook",
            },
            qq: {
                enabled: false,
                botId: "",
                token: "",
            },
            wecom: {
                enabled: false,
                corpId: "",
                agentId: "",
                secret: "",
            },
        },
        feishu: {
            appId: "cli_123",
            appSecret: "secret_123",
            botName: "Claw Assistant",
            webhookUrl: "https://example.com/hook",
        },
    };
    await (0, config_1.saveConfig)(configPath, config);
    const raw = await (0, promises_1.readFile)(configPath, "utf8");
    strict_1.default.ok(raw.includes("\"appId\": \"cli_123\""));
    const env = (0, config_1.toEnv)(config);
    strict_1.default.ok(env.includes("FEISHU_APP_ID=cli_123"));
    strict_1.default.ok(env.includes("OPENCLAW_STATE_DIR=/tmp/openclaw/state"));
}
async function run() {
    await testConfigValidation();
    await testSaveAndEnv();
    console.log("Smoke tests passed.");
}
run().catch((error) => {
    console.error(error);
    process.exit(1);
});

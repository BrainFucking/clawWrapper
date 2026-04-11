import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveConfig, toEnv, validateConfig, type OpenClawConfig } from "../cli/src/openclaw/config";

async function testConfigValidation(): Promise<void> {
  const badConfig: OpenClawConfig = {
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
  const errors = validateConfig(badConfig);
  assert.equal(errors.length, 6, "expected six validation errors");
}

async function testSaveAndEnv(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-wrapper-test-"));
  const configPath = path.join(tempDir, "config.json");
  const config: OpenClawConfig = {
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

  await saveConfig(configPath, config);
  const raw = await readFile(configPath, "utf8");
  assert.ok(raw.includes("\"appId\": \"cli_123\""));

  const env = toEnv(config);
  assert.ok(env.includes("FEISHU_APP_ID=cli_123"));
  assert.ok(env.includes("OPENCLAW_STATE_DIR=/tmp/openclaw/state"));
}

async function run(): Promise<void> {
  await testConfigValidation();
  await testSaveAndEnv();
  console.log("Smoke tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface OpenClawConfig {
  openclaw: {
    home?: string;
    stateDir?: string;
    configPath?: string;
  };
  models: {
    provider: string;
    baseUrl: string;
    apiKeyEnv: string;
    defaultModel: string;
    dailyLimit: string;
    list: Array<{
      id: string;
      name: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
    }>;
  };
  channels: {
    feishu: {
      enabled: boolean;
      appId: string;
      appSecret: string;
      botName: string;
      webhookUrl: string;
    };
    qq: {
      enabled: boolean;
      botId: string;
      token: string;
    };
    wecom: {
      enabled: boolean;
      corpId: string;
      agentId: string;
      secret: string;
    };
  };
  feishu: {
    appId: string;
    appSecret: string;
    botName: string;
    webhookUrl: string;
  };
}

const DEFAULT_CONFIG: OpenClawConfig = {
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
      botName: "Claw Assistant",
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
  feishu: {
    appId: "",
    appSecret: "",
    botName: "Claw Assistant",
    webhookUrl: "",
  },
};

export async function loadConfig(configPath: string): Promise<OpenClawConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpenClawConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      openclaw: {
        ...DEFAULT_CONFIG.openclaw,
        ...(parsed.openclaw ?? {}),
      },
      models: {
        ...DEFAULT_CONFIG.models,
        ...(parsed.models ?? {}),
        list: parsed.models?.list ?? DEFAULT_CONFIG.models.list,
      },
      channels: {
        ...DEFAULT_CONFIG.channels,
        ...(parsed.channels ?? {}),
        feishu: {
          ...DEFAULT_CONFIG.channels.feishu,
          ...(parsed.channels?.feishu ?? {}),
        },
        qq: {
          ...DEFAULT_CONFIG.channels.qq,
          ...(parsed.channels?.qq ?? {}),
        },
        wecom: {
          ...DEFAULT_CONFIG.channels.wecom,
          ...(parsed.channels?.wecom ?? {}),
        },
      },
      feishu: {
        ...DEFAULT_CONFIG.feishu,
        ...(parsed.feishu ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function validateConfig(config: OpenClawConfig): string[] {
  const errors: string[] = [];
  const feishuEnabled = config.channels.feishu.enabled;
  const appId = config.channels.feishu.appId || config.feishu.appId;
  const appSecret = config.channels.feishu.appSecret || config.feishu.appSecret;
  const webhookUrl = config.channels.feishu.webhookUrl || config.feishu.webhookUrl;

  // Model config required for OpenClaw onboarding:
  // - provider/baseUrl define the model endpoint
  // - apiKeyEnv defines which env var holds the api key
  // - defaultModel selects the primary model reference
  const modelsProvider = config.models.provider?.trim() ?? "";
  const modelsBaseUrl = config.models.baseUrl?.trim() ?? "";
  const modelsApiKeyEnv = config.models.apiKeyEnv?.trim() ?? "";
  const modelsDefaultModel = config.models.defaultModel?.trim() ?? "";
  if (!modelsProvider) {
    errors.push("models.provider is required.");
  }
  if (!modelsBaseUrl) {
    errors.push("models.baseUrl is required.");
  }
  if (!modelsApiKeyEnv) {
    errors.push("models.apiKeyEnv is required.");
  }
  if (!modelsDefaultModel) {
    errors.push("models.defaultModel is required.");
  }
  if (config.models.list.length === 0) {
    errors.push("models.list must include at least one model entry.");
  }

  // Lightweight numeric sanity checks (keeps error messages actionable).
  if (
    config.models.list.some(
      (m) => !Number.isFinite(m.contextWindow) || m.contextWindow <= 0 || !Number.isFinite(m.maxTokens) || m.maxTokens <= 0,
    )
  ) {
    errors.push("models.list entries require positive contextWindow and maxTokens.");
  }
  if (feishuEnabled && !appId.trim()) {
    errors.push("feishu.appId is required.");
  }
  if (feishuEnabled && !appSecret.trim()) {
    errors.push("feishu.appSecret is required.");
  }
  if (feishuEnabled && !webhookUrl.trim()) {
    errors.push("feishu.webhookUrl is required.");
  }
  if (config.models.list.some((model) => !model.id?.trim())) {
    errors.push("models.list entries require model id.");
  }
  return errors;
}

export async function saveConfig(configPath: string, config: OpenClawConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function toEnv(config: OpenClawConfig): string {
  const lines = [
    `OPENCLAW_HOME=${config.openclaw.home ?? ""}`,
    `OPENCLAW_STATE_DIR=${config.openclaw.stateDir ?? ""}`,
    `OPENCLAW_CONFIG_PATH=${config.openclaw.configPath ?? ""}`,
    `FEISHU_APP_ID=${config.channels.feishu.appId || config.feishu.appId}`,
    `FEISHU_APP_SECRET=${config.channels.feishu.appSecret || config.feishu.appSecret}`,
    `FEISHU_BOT_NAME=${config.channels.feishu.botName || config.feishu.botName}`,
    `FEISHU_WEBHOOK_URL=${config.channels.feishu.webhookUrl || config.feishu.webhookUrl}`,
    `OPENCLAW_MODEL_PROVIDER=${config.models.provider}`,
    `OPENCLAW_MODEL_BASE_URL=${config.models.baseUrl}`,
    `OPENCLAW_MODEL_API_KEY_ENV=${config.models.apiKeyEnv}`,
    `OPENCLAW_DEFAULT_MODEL=${config.models.defaultModel}`,
    `OPENCLAW_DAILY_LIMIT=${config.models.dailyLimit}`,
  ];
  return `${lines.join("\n")}\n`;
}

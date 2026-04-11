export const feishuSelectors = {
  consoleEntryButtons: [
    'a:has-text("控制台")',
    'button:has-text("控制台")',
    'a:has-text("开发者后台")',
    'button:has-text("开发者后台")',
    'a:has-text("Console")',
    'button:has-text("Console")',
  ],
  appNameInput: 'input[placeholder*="应用名称"], input[placeholder*="App name"]',
  botNameInputs: [
    'input[placeholder*="机器人名称"]',
    'input[placeholder*="Bot Name"]',
    'input[placeholder*="应用名称"]',
    'input[placeholder*="App name"]',
  ],
  saveButton:
    'button:has-text("保存"), button:has-text("Save"), button:has-text("创建"), button:has-text("Create")',
  appIdText:
    'text=/App ID|应用 ID|应用ID/i, [data-testid="app-id"], code:has-text("cli_")',
  appSecretText:
    'text=/App Secret|应用 Secret|应用密钥/i, [data-testid="app-secret"], code:has-text("secret_")',
  createAppButtons: [
    'button:has-text("创建企业自建应用")',
    'button:has-text("创建应用")',
    'button:has-text("Create App")',
  ],
  selfBuiltAppTabButtons: [
    'a:has-text("企业自建应用")',
    'button:has-text("企业自建应用")',
    '[role="tab"]:has-text("企业自建应用")',
    '[role="tab"]:has-text("自建应用")',
    'div:has-text("企业自建应用")',
  ],
  credentialNavButtons: [
    'a:has-text("凭证与基础信息")',
    'button:has-text("凭证与基础信息")',
    'span:has-text("凭证与基础信息")',
    'a:has-text("基础信息")',
    'button:has-text("基础信息")',
    'a:has-text("Credentials")',
  ],
  permissionNavButtons: [
    // 与官方文档「开发配置 > 权限管理」一致，参见卡片交互机器人配置说明
    'a:has-text("权限管理")',
    'button:has-text("权限管理")',
    'span:has-text("权限管理")',
    'div:has-text("权限管理")',
    'a:has-text("API 权限")',
    'button:has-text("API 权限")',
    'a:has-text("开发配置")',
    'button:has-text("开发配置")',
    'span:has-text("开发配置")',
    'a:has-text("权限配置")',
    'button:has-text("权限配置")',
    'a:has-text("Permission")',
    'button:has-text("Permission")',
    'a:has-text("Scopes")',
    'button:has-text("Scopes")',
  ],
  batchImportButtons: [
    'button:has-text("批量导入")',
    'button:has-text("导入权限")',
    'button:has-text("一键导入")',
    'button:has-text("导入")',
    'a:has-text("批量导入")',
    'a:has-text("导入权限")',
    'button:has-text("Batch Import")',
    'button:has-text("Import")',
  ],
  permissionImportInputs: [
    "textarea",
    'textarea[placeholder*="JSON"]',
    'textarea[placeholder*="json"]',
    'input[placeholder*="JSON"]',
    '[contenteditable="true"]',
  ],
  confirmButtons: [
    'button:has-text("确认")',
    'button:has-text("保存")',
    'button:has-text("导入")',
    'button:has-text("确定")',
    'button:has-text("提交")',
    'button:has-text("完成")',
    'button:has-text("Confirm")',
    'button:has-text("Save")',
    'button:has-text("Import")',
    'button:has-text("Submit")',
  ],
  capabilityNavButtons: [
    'a:has-text("应用能力")',
    'button:has-text("应用能力")',
    'span:has-text("应用能力")',
    'div:has-text("应用能力")',
    'a:has-text("添加应用能力")',
    'button:has-text("添加应用能力")',
    'a:has-text("功能配置")',
    'button:has-text("功能配置")',
    'a:has-text("Capabilities")',
    'button:has-text("Capabilities")',
  ],
  botCapabilityButtons: [
    'a:has-text("机器人")',
    'button:has-text("机器人")',
    'span:has-text("机器人")',
    'div:has-text("机器人")',
    'label:has-text("机器人")',
    'button:has-text("启用机器人")',
    'button:has-text("开启机器人")',
    'a:has-text("Bot")',
    'button:has-text("Bot")',
  ],
};

export const feishuUrls = {
  developerConsole: "https://open.feishu.cn/app",
  /** 官方文档：基础信息 / 开发配置 / 应用能力 等入口，路径随控制台改版可能需调整 */
  docReference:
    "https://open.feishu.cn/document/develop-a-card-interactive-bot/faqs?lang=zh-CN",
};

/** 直达应用子页（多路径容错，适配不同控制台版本） */
export function feishuAppSubpageUrls(appId: string): string[] {
  const id = appId.trim();
  if (!id.startsWith("cli_")) {
    return [];
  }
  const base = `https://open.feishu.cn/app/${id}`;
  return [
    `${base}/develop/security/permission`,
    `${base}/develop/permission`,
    `${base}/permission`,
    `${base}/credential`,
    `${base}/baseinfo`,
    `${base}/ability`,
    `${base}/ability/add`,
  ];
}

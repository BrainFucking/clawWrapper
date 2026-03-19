import { writeFile } from "node:fs/promises";
import path from "node:path";
import { feishuSelectors, feishuUrls } from "./selectors";

export interface GuidedSetupOptions {
  outputPath: string;
  botName: string;
  headless: boolean;
}

export interface GuidedSetupResult {
  outputPath: string;
  captured: {
    appId: string;
    appSecret: string;
    webhookUrl: string;
  };
  steps: string[];
}

const FEISHU_PERMISSION_IMPORT_JSON = JSON.stringify(
  {
    scopes: {
      tenant: [
        "aily:file:read",
        "aily:file:write",
        "application:application.app_message_stats.overview:readonly",
        "application:application:self_manage",
        "application:bot.menu:write",
        "cardkit:card:write",
        "contact:user.employee_id:readonly",
        "corehr:file:download",
        "docs:document.content:read",
        "event:ip_list",
        "im:chat",
        "im:chat.access_event.bot_p2p_chat:read",
        "im:chat.members:bot_access",
        "im:message",
        "im:message.group_at_msg:readonly",
        "im:message.group_msg",
        "im:message.p2p_msg:readonly",
        "im:message:readonly",
        "im:message:send_as_bot",
        "im:resource",
        "sheets:spreadsheet",
        "wiki:wiki:readonly",
      ],
      user: ["aily:file:read", "aily:file:write", "im:chat.access_event.bot_p2p_chat:read"],
    },
  },
  null,
  2,
);

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickFirstVisible(page: any, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        await locator.click({ timeout: 2000 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

async function fillFirstVisible(page: any, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        await locator.fill(value, { timeout: 2000 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

function extractByRegex(text: string, regex: RegExp): string {
  const match = text.match(regex);
  return match?.[1]?.trim() ?? "";
}

async function clickConsoleEntry(page: any, steps: string[]): Promise<boolean> {
  if (await clickFirstVisible(page, feishuSelectors.consoleEntryButtons)) {
    steps.push("Clicked Feishu 控制台 / 开发者后台.");
    await delay(1200);
    return true;
  }
  try {
    const roleLink = page.getByRole("link", { name: /控制台|开发者后台|console/i }).first();
    if (await roleLink.isVisible({ timeout: 1200 })) {
      await roleLink.click({ timeout: 2500 });
      steps.push("Clicked console entry via role locator.");
      await delay(1200);
      return true;
    }
  } catch {
    // continue
  }
  return false;
}

async function waitForConsolePageReady(page: any, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
      const ready =
        body.includes("创建企业自建应用") ||
        body.includes("应用管理") ||
        body.includes("凭证与基础信息") ||
        body.includes("权限管理");
      if (ready) {
        return true;
      }
    } catch {
      // keep waiting
    }
    await delay(1200);
  }
  return false;
}

async function waitForManualLogin(page: any, timeoutMs: number, steps: string[]): Promise<boolean> {
  steps.push("Opened Feishu console in one tab. Please scan QR/login in that tab.");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const currentUrl = page.url();
      const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
      const loggedInByUrl = currentUrl.includes("open.feishu.cn/app");
      const loggedInByUi =
        body.includes("控制台") ||
        body.includes("开发者后台") ||
        body.includes("创建企业自建应用") ||
        body.includes("应用管理") ||
        body.includes("凭证与基础信息") ||
        body.includes("权限管理") ||
        body.includes("app id");
      if (loggedInByUrl && loggedInByUi) {
        steps.push("Login detected, continue automation.");
        return true;
      }
    } catch {
      // keep waiting
    }
    await delay(1500);
  }
  steps.push("Login wait timed out. Browser remains open for manual continuation.");
  return false;
}

export async function runGuidedFeishuSetup(
  options: GuidedSetupOptions,
): Promise<GuidedSetupResult> {
  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const steps: string[] = [];

  await page.goto(feishuUrls.developerConsole, { waitUntil: "domcontentloaded" });
  const loggedIn = await waitForManualLogin(page, 5 * 60 * 1000, steps);
  if (!loggedIn) {
    const timeoutResult: GuidedSetupResult = {
      outputPath: options.outputPath,
      captured: { appId: "", appSecret: "", webhookUrl: "" },
      steps,
    };
    await writeFile(path.resolve(options.outputPath), `${JSON.stringify(timeoutResult, null, 2)}\n`, "utf8");
    await browser.close();
    return timeoutResult;
  }

  const enteredConsole = await clickConsoleEntry(page, steps);
  if (!enteredConsole) {
    steps.push("Console entry not clicked automatically. Waiting for console-ready page...");
  }
  const consoleReady = await waitForConsolePageReady(page, 90 * 1000);
  if (!consoleReady) {
    steps.push("Console page not ready after login. Please click 控制台 manually, then rerun automation.");
  } else {
    steps.push("Console page ready. Continue with semi-automation.");
  }

  try {
    const created = await clickFirstVisible(page, feishuSelectors.createAppButtons);
    if (created) {
      steps.push("Clicked create-app entry.");
      await delay(800);
    } else {
      steps.push("Create-app entry not found, assuming existing app page.");
    }
  } catch {
    steps.push("Create-app click skipped due to UI mismatch.");
  }

  try {
    const named = await fillFirstVisible(page, [feishuSelectors.appNameInput], options.botName);
    if (named) {
      steps.push(`Filled app/bot name: ${options.botName}`);
      await clickFirstVisible(page, [feishuSelectors.saveButton]);
      await delay(1000);
    } else {
      steps.push("App name input not found; skipped naming step.");
    }
  } catch {
    steps.push("Naming step skipped due to UI mismatch.");
  }

  try {
    const openedPerm = await clickFirstVisible(page, feishuSelectors.permissionNavButtons);
    if (openedPerm) {
      steps.push("Opened permission management page.");
      await delay(1000);
      const openedBatchImport = await clickFirstVisible(page, feishuSelectors.batchImportButtons);
      if (openedBatchImport) {
        steps.push("Opened batch import dialog.");
        await delay(500);
        const filledPermissionJson = await fillFirstVisible(page, feishuSelectors.permissionImportInputs, FEISHU_PERMISSION_IMPORT_JSON);
        if (filledPermissionJson) {
          steps.push("Filled permission import JSON.");
          await clickFirstVisible(page, feishuSelectors.confirmButtons);
          await delay(1200);
          steps.push("Submitted permission import.");
        } else {
          steps.push("Permission import input not found; please paste JSON manually.");
        }
      } else {
        steps.push("Batch import button not found; please configure permissions manually.");
      }
    } else {
      steps.push("Permission page entry not found; skipped permission automation.");
    }
  } catch {
    steps.push("Permission automation partially failed due to UI mismatch.");
  }

  try {
    const openedCapability = await clickFirstVisible(page, feishuSelectors.capabilityNavButtons);
    if (openedCapability) {
      steps.push("Opened capability section.");
      await delay(800);
      await clickFirstVisible(page, feishuSelectors.botCapabilityButtons);
      await delay(800);
      await fillFirstVisible(page, feishuSelectors.botNameInputs, options.botName);
      await clickFirstVisible(page, [feishuSelectors.saveButton]);
      steps.push("Bot capability setup attempted.");
    } else {
      steps.push("Capability page entry not found; skipped bot capability automation.");
    }
  } catch {
    steps.push("Bot capability automation partially failed due to UI mismatch.");
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const appIdFromUrl = extractByRegex(page.url(), /(cli_[a-zA-Z0-9]+)/);
  const appId = appIdFromUrl || extractByRegex(bodyText, /(cli_[a-zA-Z0-9]{8,})/);
  const appSecret = extractByRegex(bodyText, /(secret_[a-zA-Z0-9_\-]+)/i);
  const webhookUrl = extractByRegex(bodyText, /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_\-]+)/i);

  const result: GuidedSetupResult = {
    outputPath: options.outputPath,
    captured: { appId, appSecret, webhookUrl },
    steps,
  };

  await writeFile(
    path.resolve(options.outputPath),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );

  await browser.close();
  return result;
}

import { writeFile } from "node:fs/promises";
import path from "node:path";

export interface OneThingSetupOptions {
  outputPath: string;
  headless: boolean;
}

export interface OneThingSetupResult {
  outputPath: string;
  captured: {
    apiKey: string;
  };
  steps: string[];
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickFirstVisible(page: any, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        await locator.click({ timeout: 2500 });
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
        await locator.fill(value, { timeout: 2500 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

async function clickConsoleEntry(page: any, steps: string[]): Promise<boolean> {
  const consoleSelectors = [
    'a:has-text("控制台")',
    'button:has-text("控制台")',
    '[role="link"]:has-text("控制台")',
  ];

  // Strategy 1: selector click
  if (await clickFirstVisible(page, consoleSelectors)) {
    steps.push("Clicked 控制台 entry.");
    await delay(1200);
    return true;
  }

  // Strategy 2: aria role locator
  try {
    const link = page.getByRole("link", { name: /控制台/ }).first();
    if (await link.isVisible({ timeout: 1200 })) {
      await link.click({ timeout: 2500 });
      steps.push("Clicked 控制台 entry via role locator.");
      await delay(1200);
      return true;
    }
  } catch {
    // continue
  }

  // Strategy 3: direct URL guess as fallback
  for (const url of [
    "https://console.onethingai.com/",
    "https://onethingai.com/console",
    "https://onethingai.com/dashboard",
  ]) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 6000 });
      steps.push(`Opened console by URL fallback: ${url}`);
      return true;
    } catch {
      // try next URL
    }
  }
  return false;
}

function extractApiKey(text: string): string {
  const patterns = [
    /\b(sk-[A-Za-z0-9_\-]{10,})\b/,
    /\b(ok-[A-Za-z0-9_\-]{10,})\b/,
    /\b(ot[a-z0-9_\-]{12,})\b/i,
    /\b([A-Za-z0-9_\-]{24,})\b/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

async function waitForManualLogin(page: any, timeoutMs: number, steps: string[]): Promise<boolean> {
  steps.push("Opened OneThingAI page in one tab. Please register/login first.");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
      const maybeLoggedIn =
        body.includes("api key") ||
        body.includes("api keys") ||
        body.includes("控制台") ||
        body.includes("dashboard") ||
        body.includes("用量") ||
        body.includes("账单");
      if (maybeLoggedIn) {
        steps.push("Login detected; continue API key automation.");
        return true;
      }
    } catch {
      // continue waiting
    }
    await delay(1500);
  }
  steps.push("Login wait timed out. Browser remains open for manual continuation.");
  return false;
}

export async function runOneThingApiKeySetup(
  options: OneThingSetupOptions,
): Promise<OneThingSetupResult> {
  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const steps: string[] = [];

  await page.goto("https://onethingai.com/", { waitUntil: "domcontentloaded" });
  const loggedIn = await waitForManualLogin(page, 5 * 60 * 1000, steps);
  if (!loggedIn) {
    const timeoutResult: OneThingSetupResult = {
      outputPath: options.outputPath,
      captured: { apiKey: "" },
      steps,
    };
    await writeFile(path.resolve(options.outputPath), `${JSON.stringify(timeoutResult, null, 2)}\n`, "utf8");
    await browser.close();
    return timeoutResult;
  }

  const openedConsole = await clickConsoleEntry(page, steps);
  if (!openedConsole) {
    steps.push("控制台入口未找到；请先手动点击页面右上角“控制台”，然后重试。");
  }

  const apiKeyNavSelectors = [
    'a:has-text("总览")',
    'button:has-text("总览")',
    'a:has-text("大模型API")',
    'button:has-text("大模型API")',
    'a:has-text("API Key")',
    'a:has-text("API Keys")',
    'button:has-text("API Key")',
    'button:has-text("API Keys")',
    'a:has-text("密钥")',
    'button:has-text("密钥")',
  ];
  const createKeySelectors = [
    'button:has-text("创建 API 密钥")',
    'button:has-text("创建API密钥")',
    'a:has-text("创建 API 密钥")',
    'a:has-text("创建API密钥")',
    'button:has-text("+ 创建 API 密钥")',
    'button:has-text("+创建 API 密钥")',
    'button:has-text("Create API Key")',
    'button:has-text("Create Key")',
    'button:has-text("新建 API Key")',
    'button:has-text("创建 API Key")',
    'button:has-text("创建密钥")',
    'button:has-text("新建密钥")',
  ];
  const keyNameInputs = [
    'input[placeholder*="API"]',
    'input[placeholder*="Key Name"]',
    'input[placeholder*="name"]',
    'input[placeholder*="名称"]',
    'input[aria-label*="name"]',
  ];
  const confirmSelectors = [
    'button:has-text("创建 API 密钥")',
    'button:has-text("创建密钥")',
    'button:has-text("Create")',
    'button:has-text("Confirm")',
    'button:has-text("确认")',
    'button:has-text("保存")',
  ];

  try {
    const openedApiKeyPage = await clickFirstVisible(page, apiKeyNavSelectors);
    if (openedApiKeyPage) {
      steps.push("Opened dashboard/API key related page.");
      await delay(1000);
    } else {
      steps.push("API key navigation entry not found; trying direct URL guesses.");
      for (const url of ["https://onethingai.com/api-keys", "https://onethingai.com/dashboard/api-keys"]) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
          steps.push(`Visited ${url}`);
          break;
        } catch {
          // try next URL
        }
      }
    }
  } catch {
    steps.push("Failed to open API key page automatically.");
  }

  try {
    const clickedCreate = await clickFirstVisible(page, createKeySelectors);
    if (clickedCreate) {
      steps.push("Clicked create API key.");
      await delay(700);
      const keyName = `openclaw-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}`;
      if (await fillFirstVisible(page, keyNameInputs, keyName)) {
        steps.push(`Filled key name: ${keyName}`);
      }
      await clickFirstVisible(page, confirmSelectors);
      await delay(1500);
      steps.push("Submitted create API key.");
    } else {
      steps.push("Create API key button not found; please create manually on the current page.");
    }
  } catch {
    steps.push("Create API key step partially failed due to UI mismatch.");
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const apiKey = extractApiKey(bodyText);
  if (apiKey) {
    steps.push("Captured API key from page.");
  } else {
    steps.push("No API key captured automatically; copy it manually from page.");
  }

  const result: OneThingSetupResult = {
    outputPath: options.outputPath,
    captured: { apiKey },
    steps,
  };
  await writeFile(path.resolve(options.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await browser.close();
  return result;
}

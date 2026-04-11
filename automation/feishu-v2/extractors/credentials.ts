import type { CapturedCredentials } from "../types";
import type { Page } from "playwright";

function extractByRegex(text: string, regex: RegExp): string | undefined {
  const match = text.match(regex);
  return match?.[1]?.trim();
}

export function extractCredentialsFromText(pageUrl: string, bodyText: string): CapturedCredentials {
  const appId =
    extractByRegex(pageUrl, /(cli_[a-zA-Z0-9]+)/) ??
    extractByRegex(bodyText, /(cli_[a-zA-Z0-9]{8,})/) ??
    "";
  const appSecret = extractByRegex(bodyText, /(secret_[a-zA-Z0-9_\-]+)/i);
  const webhookUrl = extractByRegex(
    bodyText,
    /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_\-]+)/i,
  );

  return { appId, appSecret, webhookUrl };
}

async function readTextBySelectors(page: Page, selectors: string[]): Promise<string | undefined> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1200 })) {
        const text = (await locator.innerText({ timeout: 1200 })).trim();
        if (text) {
          return text;
        }
      }
    } catch {
      // try next selector
    }
  }
  return undefined;
}

export async function extractCredentialsFromPage(page: Page): Promise<CapturedCredentials> {
  const appIdText =
    (await readTextBySelectors(page, [
      '[data-testid="app-id"]',
      'code:has-text("cli_")',
      'text=/App ID|应用 ID|应用ID/i',
    ])) ?? "";
  const appSecretText =
    (await readTextBySelectors(page, [
      '[data-testid="app-secret"]',
      'code:has-text("secret_")',
      'text=/App Secret|应用 Secret|应用密钥/i',
    ])) ?? "";
  const webhookText = (await readTextBySelectors(page, ['text=/open-apis\\/bot\\/v2\\/hook\\//i'])) ?? "";

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const fallback = extractCredentialsFromText(page.url(), bodyText);

  const appId = extractByRegex(appIdText, /(cli_[a-zA-Z0-9]{8,})/) ?? fallback.appId;
  const appSecret = extractByRegex(appSecretText, /(secret_[a-zA-Z0-9_\-]+)/i) ?? fallback.appSecret;
  const webhookUrl =
    extractByRegex(
      webhookText,
      /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_\-]+)/i,
    ) ?? fallback.webhookUrl;

  return { appId: appId ?? "", appSecret, webhookUrl };
}


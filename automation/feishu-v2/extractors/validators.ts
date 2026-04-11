import type { CapturedCredentials } from "../types";

export function isValidAppId(value: string): boolean {
  return /^cli_[a-zA-Z0-9]{8,}$/.test(value);
}

export function validateCapturedCredentials(captured: CapturedCredentials): string[] {
  const errors: string[] = [];
  if (!captured.appId || !isValidAppId(captured.appId)) {
    errors.push("Missing or invalid appId.");
  }
  if (captured.webhookUrl && !captured.webhookUrl.startsWith("https://open.feishu.cn/open-apis/bot/v2/hook/")) {
    errors.push("webhookUrl has unexpected format.");
  }
  return errors;
}


import type { ActionOutcome } from "../types";
import type { Page } from "playwright";
import { bodyContainsAny, clickFirstVisible, delay, isTransientError } from "./actionUtils";

export async function ensureConsoleReady(page: Page, consoleSelectors: string[]): Promise<ActionOutcome<undefined>> {
  try {
    if (await clickFirstVisible(page, consoleSelectors)) {
      await delay(1000);
    }

    const start = Date.now();
    while (Date.now() - start < 90_000) {
      const ready = await bodyContainsAny(page, [
        "创建企业自建应用",
        "应用管理",
        "凭证与基础信息",
        "权限管理",
      ]);
      if (ready) {
        return { type: "ok", value: undefined, message: "Console page is ready." };
      }
      await delay(1200);
    }
    return {
      type: "manual_required",
      message: "Console page not ready.",
      hint: "Please click 控制台 / Console manually, then resume.",
    };
  } catch (error) {
    if (isTransientError(error)) {
      return { type: "retryable_error", message: "Transient console readiness failure.", cause: error };
    }
    return { type: "fatal_error", message: "Failed to ensure console readiness.", cause: error };
  }
}


import type { ActionOutcome } from "../types";
import type { Page } from "playwright";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 600,
  maxDelayMs: 5000,
};

function nextDelay(prevDelay: number, policy: RetryPolicy): number {
  const upper = Math.min(policy.maxDelayMs, Math.max(policy.baseDelayMs, prevDelay * 3));
  const lower = policy.baseDelayMs;
  return Math.floor(lower + Math.random() * (upper - lower + 1));
}

export async function withRetry<T>(
  run: () => Promise<ActionOutcome<T>>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<ActionOutcome<T>> {
  let attempt = 0;
  let backoffMs = policy.baseDelayMs;
  while (attempt < policy.maxAttempts) {
    const outcome = await run();
    if (outcome.type !== "retryable_error") {
      return outcome;
    }
    attempt += 1;
    if (attempt >= policy.maxAttempts) {
      return outcome;
    }
    backoffMs = nextDelay(backoffMs, policy);
    await delay(backoffMs);
  }
  return { type: "fatal_error", message: "Retry exhausted without terminal outcome." };
}

export function isTransientError(error: unknown): boolean {
  const msg = String(error ?? "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("detached") ||
    msg.includes("stale") ||
    msg.includes("navigation") ||
    msg.includes("frame")
  );
}

export async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        await locator.click({ timeout: 2500 });
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  return false;
}

export async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        await locator.fill(value, { timeout: 2500 });
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  return false;
}

export async function bodyContainsAny(page: Page, terms: string[]): Promise<boolean> {
  try {
    const body = (await page.locator("body").innerText({ timeout: 1500 })).toLowerCase();
    return terms.some((term) => body.includes(term.toLowerCase()));
  } catch {
    return false;
  }
}


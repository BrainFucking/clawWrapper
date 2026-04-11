import type { ActionOutcome } from "../types";
import type { Page } from "playwright";
import { clickFirstVisible, delay, fillFirstVisible, isTransientError } from "./actionUtils";

export interface EnsureAppSelectors {
  createAppButton: string[];
  appNameInput: string[];
  saveButton: string[];
}

export async function ensureApp(
  page: Page,
  botName: string,
  selectors: EnsureAppSelectors,
): Promise<ActionOutcome<undefined>> {
  try {
    await clickFirstVisible(page, selectors.createAppButton);
    await delay(800);

    const filled = await fillFirstVisible(page, selectors.appNameInput, botName);
    if (!filled) {
      return {
        type: "manual_required",
        message: "App name input not found.",
        hint: "Create/select app manually and set app name, then resume.",
      };
    }

    await clickFirstVisible(page, selectors.saveButton);
    await delay(900);
    return { type: "ok", value: undefined, message: "App creation/selection completed." };
  } catch (error) {
    if (isTransientError(error)) {
      return { type: "retryable_error", message: "Transient app creation failure.", cause: error };
    }
    return { type: "fatal_error", message: "Failed to create/select app.", cause: error };
  }
}


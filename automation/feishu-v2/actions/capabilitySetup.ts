import type { ActionOutcome } from "../types";
import type { Page } from "playwright";
import { clickFirstVisible, delay, fillFirstVisible, isTransientError } from "./actionUtils";

export interface CapabilitySelectors {
  capabilityNav: string[];
  botCapability: string[];
  appNameInput: string[];
  saveButton: string[];
}

export async function ensureCapability(
  page: Page,
  botName: string,
  selectors: CapabilitySelectors,
): Promise<ActionOutcome<undefined>> {
  try {
    const openedCapability = await clickFirstVisible(page, selectors.capabilityNav);
    if (!openedCapability) {
      return {
        type: "manual_required",
        message: "Capability page entry not found.",
        hint: "Open 应用能力 / Capabilities manually and continue.",
      };
    }
    await delay(700);

    await clickFirstVisible(page, selectors.botCapability);
    await delay(700);
    await fillFirstVisible(page, selectors.appNameInput, botName);
    await clickFirstVisible(page, selectors.saveButton);
    await delay(800);
    return { type: "ok", value: undefined, message: "Bot capability setup attempted." };
  } catch (error) {
    if (isTransientError(error)) {
      return { type: "retryable_error", message: "Transient capability setup failure.", cause: error };
    }
    return { type: "fatal_error", message: "Capability setup failed.", cause: error };
  }
}


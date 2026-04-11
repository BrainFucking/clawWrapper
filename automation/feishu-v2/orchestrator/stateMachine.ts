import type { SetupStep } from "../types";

export const SETUP_STEP_ORDER: SetupStep[] = [
  "OPEN_CONSOLE",
  "WAIT_MANUAL_LOGIN",
  "ENSURE_CONSOLE_READY",
  "ENSURE_APP",
  "PERMISSIONS",
  "CAPABILITIES",
  "EXTRACT_CREDENTIALS",
  "VERIFY",
  "PERSIST",
];

export function nextStep(current?: SetupStep): SetupStep | undefined {
  if (!current) {
    return SETUP_STEP_ORDER[0];
  }
  const idx = SETUP_STEP_ORDER.indexOf(current);
  if (idx < 0 || idx + 1 >= SETUP_STEP_ORDER.length) {
    return undefined;
  }
  return SETUP_STEP_ORDER[idx + 1];
}


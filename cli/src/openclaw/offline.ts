import { join } from "node:path";

export const OFFLINE_PNPM_TGZ = join(process.cwd(), "vendor", "offline", "pnpm.tgz");
export const OFFLINE_PNPM_STORE = join(process.cwd(), "vendor", "offline", "pnpm-store");
export const OFFLINE_PLAYWRIGHT_BROWSERS = join(process.cwd(), "vendor", "offline", "ms-playwright");

export function isOfflineMode(): boolean {
  const raw = (process.env.CLAW_WRAPPER_OFFLINE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

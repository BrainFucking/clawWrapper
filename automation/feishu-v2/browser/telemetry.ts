import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

export async function saveHtmlArtifact(artifactsDir: string, name: string, html: string): Promise<string> {
  await mkdir(artifactsDir, { recursive: true });
  const filePath = path.join(artifactsDir, `${name}.html`);
  await writeFile(filePath, html, "utf8");
  return filePath;
}

export async function capturePageArtifacts(
  page: Page,
  artifactsDir: string,
  name: string,
): Promise<{ screenshotPath?: string; htmlPath?: string }> {
  await mkdir(artifactsDir, { recursive: true });
  const screenshotTarget = path.join(artifactsDir, `${name}.png`);
  let screenshotPath: string | undefined;
  let htmlPath: string | undefined;

  try {
    await page.screenshot({ path: screenshotTarget, fullPage: true });
    screenshotPath = screenshotTarget;
  } catch {
    // best effort
  }
  try {
    const html = await page.content();
    htmlPath = await saveHtmlArtifact(artifactsDir, name, html);
  } catch {
    // best effort
  }

  return {
    screenshotPath,
    htmlPath,
  };
}


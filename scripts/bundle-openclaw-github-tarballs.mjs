#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const lockfilePath = path.join(rootDir, "vendor", "openclaw", "pnpm-lock.yaml");
const outputDir = path.join(rootDir, "vendor", "github-tarballs");
const manifestPath = path.join(outputDir, "manifest.json");

const lockContent = await readFile(lockfilePath, "utf8");
const matches = lockContent.match(/https:\/\/codeload\.github\.com\/[^\s'"]+\/tar\.gz\/[A-Za-z0-9._-]+/g) ?? [];
const urls = [...new Set(matches)].sort();

if (urls.length === 0) {
  console.log("No GitHub tarballs detected in pnpm-lock.yaml.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

function toFileName(url) {
  const u = new URL(url);
  const segments = u.pathname.split("/").filter(Boolean);
  const owner = segments[0] ?? "unknown";
  const repo = segments[1] ?? "unknown";
  const rev = segments[segments.length - 1] ?? "unknown";
  return `${owner}__${repo}__${rev}.tgz`;
}

async function sha256OfFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const tarballs = [];
for (const url of urls) {
  const file = toFileName(url);
  const filePath = path.join(outputDir, file);
  let exists = false;
  try {
    const info = await stat(filePath);
    exists = info.isFile() && info.size > 0;
  } catch {
    exists = false;
  }
  if (!exists) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, data);
  } else {
    console.log(`Reuse existing ${file}`);
  }
  const sha256 = await sha256OfFile(filePath);
  tarballs.push({ url, file, sha256 });
}

await writeFile(
  manifestPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      tarballs,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`Bundled ${tarballs.length} GitHub tarballs into ${outputDir}`);

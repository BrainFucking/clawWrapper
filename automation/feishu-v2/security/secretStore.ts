import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SecretStore {
  put(secret: string): Promise<string>;
  get(secretRef: string): Promise<string | undefined>;
}

class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async put(secret: string): Promise<string> {
    const secretRef = `secret://${randomUUID()}`;
    this.values.set(secretRef, secret);
    return secretRef;
  }

  async get(secretRef: string): Promise<string | undefined> {
    return this.values.get(secretRef);
  }
}

class FileSecretStore implements SecretStore {
  constructor(private readonly baseDir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private buildPath(secretRef: string): string {
    const digest = createHash("sha256").update(secretRef).digest("hex");
    return path.join(this.baseDir, `${digest}.secret`);
  }

  async put(secret: string): Promise<string> {
    await this.ensureDir();
    const secretRef = `secret://file/${randomUUID()}`;
    const target = this.buildPath(secretRef);
    await writeFile(target, secret, { encoding: "utf8", mode: 0o600 });
    return secretRef;
  }

  async get(secretRef: string): Promise<string | undefined> {
    try {
      const content = await readFile(this.buildPath(secretRef), "utf8");
      return content.trim();
    } catch {
      return undefined;
    }
  }
}

export interface SecretStoreFactoryOptions {
  kind?: "memory" | "file";
  secretsDir: string;
}

export function createSecretStore(options: SecretStoreFactoryOptions): SecretStore {
  if (options.kind === "file") {
    return new FileSecretStore(options.secretsDir);
  }
  return new MemorySecretStore();
}


import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupCheckpoint } from "../types";

export class CheckpointStore {
  constructor(private readonly runsDir: string) {}

  runDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }

  checkpointPath(runId: string): string {
    return path.join(this.runDir(runId), "checkpoint.json");
  }

  async load(runId: string): Promise<SetupCheckpoint | undefined> {
    try {
      const raw = await readFile(this.checkpointPath(runId), "utf8");
      return JSON.parse(raw) as SetupCheckpoint;
    } catch {
      return undefined;
    }
  }

  async save(checkpoint: SetupCheckpoint): Promise<void> {
    const runDir = this.runDir(checkpoint.runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(this.checkpointPath(checkpoint.runId), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  }
}


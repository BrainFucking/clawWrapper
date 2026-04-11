import type { SetupRequest, SetupResult } from "./types";
import { runFeishuSetupV2 } from "./orchestrator/runSetup";

export interface FeishuSetupEngine {
  run(request: SetupRequest): Promise<SetupResult>;
  resume(runId: string, request: Omit<SetupRequest, "resumeFromRunId">): Promise<SetupResult>;
}

class DefaultFeishuSetupEngine implements FeishuSetupEngine {
  async run(request: SetupRequest): Promise<SetupResult> {
    return runFeishuSetupV2(request);
  }

  async resume(runId: string, request: Omit<SetupRequest, "resumeFromRunId">): Promise<SetupResult> {
    return runFeishuSetupV2({ ...request, resumeFromRunId: runId });
  }
}

export function createFeishuSetupEngine(): FeishuSetupEngine {
  return new DefaultFeishuSetupEngine();
}

export type { SetupRequest, SetupResult } from "./types";


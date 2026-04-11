export type SetupStatus =
  | "init"
  | "running"
  | "paused_manual"
  | "failed"
  | "completed";

export type SetupStep =
  | "OPEN_CONSOLE"
  | "WAIT_MANUAL_LOGIN"
  | "ENSURE_CONSOLE_READY"
  | "ENSURE_APP"
  | "PERMISSIONS"
  | "CAPABILITIES"
  | "EXTRACT_CREDENTIALS"
  | "VERIFY"
  | "PERSIST";

export type SecretStoreKind = "memory" | "file";

export interface SetupRequest {
  botName: string;
  outputPath: string;
  headless: boolean;
  timeoutMs?: number;
  resumeFromRunId?: string;
  selectorPack?: string;
  secretStore?: SecretStoreKind;
  webhookProbe?: boolean;
}

export interface CapturedCredentials {
  appId: string;
  appSecret?: string;
  webhookUrl?: string;
}

export interface SetupStepEvent {
  runId: string;
  step: SetupStep;
  status: "start" | "ok" | "retry" | "manual_required" | "error";
  message: string;
  timestamp: string;
  retryCount?: number;
  artifacts?: {
    screenshotPath?: string;
    tracePath?: string;
    htmlPath?: string;
  };
}

export interface SetupCheckpoint {
  runId: string;
  version: 1;
  status: SetupStatus;
  lastCompletedStep?: SetupStep;
  request: Omit<SetupRequest, "resumeFromRunId">;
  captured: Partial<CapturedCredentials>;
  createdAt: string;
  updatedAt: string;
}

export interface SetupResult {
  runId: string;
  status: "completed" | "paused_manual" | "failed";
  outputPath: string;
  captured: {
    appId: string;
    webhookUrl?: string;
    secretRef?: string;
  };
  verification: {
    tokenCheck: "pass" | "fail" | "skipped";
    webhookProbe: "pass" | "fail" | "skipped";
  };
  stepEvents: SetupStepEvent[];
  nextAction?: string;
}

export type ActionOutcome<T> =
  | { type: "ok"; value: T; message: string }
  | { type: "manual_required"; message: string; hint: string }
  | { type: "retryable_error"; message: string; cause?: unknown }
  | { type: "fatal_error"; message: string; cause?: unknown };


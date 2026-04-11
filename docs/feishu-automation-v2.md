# Feishu Automation v2 Blueprint

This document defines a production-oriented design for automating Feishu bot registration and OpenClaw onboarding with high reliability and stronger secret handling.

## Goals

- Keep current guided UX (human-in-the-loop for login/captcha).
- Improve resilience to Feishu UI changes.
- Add secure secret storage and avoid plain-text credential leaks.
- Support resumable runs and deterministic diagnostics.
- Verify setup by running real post-provision checks.

## Non-goals

- Fully bypassing Feishu anti-bot challenges.
- Replacing Feishu Open Platform APIs where no public API exists for the UI step.
- Supporting every tenant-specific custom flow in v1.

## High-Level Architecture

- `orchestrator`: state machine, step execution, checkpoint persistence, resume.
- `browser`: Playwright lifecycle, tab/session management, trace/screenshot capture.
- `selectors`: versioned selector packs, fallback strategy, confidence scoring.
- `actions`: idempotent UI actions (click/fill/nav/import/toggle/save).
- `extractors`: DOM-first value capture, regex fallback, schema validation.
- `security`: secret vault adapters, redaction, encryption-at-rest fallback.
- `verification`: API and behavioral smoke checks.
- `reporting`: structured run report + human-readable summary.

Suggested layout:

```text
automation/feishu-v2/
  index.ts
  orchestrator/
    runSetup.ts
    stateMachine.ts
    checkpointStore.ts
  browser/
    session.ts
    telemetry.ts
  selectors/
    packs/
      default.zh-en.ts
    selectorEngine.ts
  actions/
    navigation.ts
    appCreation.ts
    permissionImport.ts
    capabilitySetup.ts
  extractors/
    credentials.ts
    validators.ts
  security/
    secretStore.ts
    redaction.ts
    envelopeCrypto.ts
  verification/
    tokenCheck.ts
    webhookProbe.ts
  reporting/
    runReport.ts
```

## End-to-End Flow (State Machine)

1. `INIT`: load config, resolve output location, open checkpoint if exists.
2. `OPEN_CONSOLE`: open `https://open.feishu.cn/app`.
3. `WAIT_MANUAL_LOGIN`: wait for user-authenticated signals.
4. `ENSURE_CONSOLE_READY`: verify app console is reachable.
5. `ENSURE_APP`: create or select target app by name.
6. `PERMISSIONS`: import required scopes (batch or fallback guided mode).
7. `CAPABILITIES`: ensure bot capability and bot display name.
8. `EXTRACT_CREDENTIALS`: capture app id/secret/webhook with validation.
9. `VERIFY`: run API/token/webhook checks.
10. `PERSIST`: write report, persist non-secret metadata, store secrets.
11. `DONE`: success.

Failure handling:

- Any step can return `RETRYABLE_ERROR`, `MANUAL_REQUIRED`, or `FATAL`.
- `MANUAL_REQUIRED` pauses and prints exact recovery instruction.
- On fatal failures, write report and checkpoint for resume.

## Data Contracts

```ts
export type SetupStatus =
  | "init"
  | "running"
  | "paused_manual"
  | "failed"
  | "completed";

export interface SetupRequest {
  botName: string;
  outputPath: string;
  headless: boolean;
  timeoutMs?: number;
  resumeFromRunId?: string;
  selectorPack?: string; // default.zh-en
  secretStore?: SecretStoreKind;
}

export interface CapturedCredentials {
  appId: string;
  appSecret?: string;
  webhookUrl?: string;
}

export interface SetupStepEvent {
  runId: string;
  step:
    | "OPEN_CONSOLE"
    | "WAIT_MANUAL_LOGIN"
    | "ENSURE_CONSOLE_READY"
    | "ENSURE_APP"
    | "PERMISSIONS"
    | "CAPABILITIES"
    | "EXTRACT_CREDENTIALS"
    | "VERIFY"
    | "PERSIST";
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
  lastCompletedStep?: SetupStepEvent["step"];
  request: Omit<SetupRequest, "resumeFromRunId">;
  captured: Partial<CapturedCredentials>;
  createdAt: string;
  updatedAt: string;
}

export interface SetupResult {
  runId: string;
  status: "completed" | "paused_manual" | "failed";
  outputPath: string;
  captured: CapturedCredentials;
  verification: {
    tokenCheck: "pass" | "fail" | "skipped";
    webhookProbe: "pass" | "fail" | "skipped";
  };
  stepEvents: SetupStepEvent[];
  nextAction?: string;
}
```

## Selector Strategy

Principles:

- Prefer stable attributes first (`data-testid`, role/name), then text selectors.
- Keep selectors in one registry with semantic names.
- Score selector success and auto-promote winners.
- Separate locale-aware text patterns from structural selectors.

Pattern:

- `SelectorSpec = { id, candidates[], required, timeoutMs }`
- `candidates` are ordered by confidence (high to low).
- Record success/failure per candidate in telemetry for future tuning.

Example:

```ts
interface SelectorCandidate {
  kind: "css" | "role" | "text";
  value: string;
  locale?: "zh-CN" | "en-US" | "any";
  confidence: number;
}

interface SelectorSpec {
  id: "createAppButton" | "permissionNav" | "batchImportButton";
  candidates: SelectorCandidate[];
  required: boolean;
  timeoutMs: number;
}
```

## Action Design (Idempotent + Observable)

Each action should:

- Check if desired state already exists before mutating.
- Emit structured step events.
- Return typed result (`ok`, `manual_required`, `retryable_error`, `fatal_error`).

Action contract:

```ts
type ActionOutcome<T> =
  | { type: "ok"; value: T; message: string }
  | { type: "manual_required"; message: string; hint: string }
  | { type: "retryable_error"; message: string; cause?: unknown }
  | { type: "fatal_error"; message: string; cause?: unknown };
```

## Retry Policy

Use bounded retry with decorrelated jitter:

- `maxAttempts`: 4 (navigation and click), 3 (form fill), 2 (credential extraction).
- `baseDelayMs`: 600
- `maxDelayMs`: 5000
- Retry only for transient classes:
  - timeout / detached node / navigation in progress / stale frame.
- Never retry for:
  - explicit permission denied,
  - selector absent after fallback exhaustion,
  - validation hard-fail (bad credential format).

Pseudo:

```ts
delay = min(maxDelayMs, random(baseDelayMs, prevDelay * 3));
```

## Secret Handling Model

Do not store raw `appSecret` in output JSON by default.

Priority order:

1. OS keychain adapter (recommended):
   - macOS: Keychain (`security` command or keytar-based adapter)
   - Windows: Credential Manager
   - Linux: Secret Service
2. Encrypted file fallback:
   - envelope encryption with locally-derived key material.
   - metadata JSON stores only reference key id and hash fingerprint.

Output JSON should contain:

- `appId`
- `webhookUrl` (optional to treat as secret by policy)
- `secretRef` (key to retrieve secret)
- verification status and report pointers

Redaction rules:

- Logs must mask:
  - `secret_*`
  - webhook full token segment
  - bearer tokens / authorization headers

## Verification Strategy

### Token Check

- Obtain tenant access token using `appId` + `appSecret` (read from secret store).
- Pass condition: Feishu token API returns success and non-empty token.

### Webhook Probe (Optional)

- Send a minimal bot message to webhook endpoint if configured.
- Pass condition: HTTP success and expected response payload.
- Mark as `skipped` if tenant policy disallows outbound probe.

### Final Acceptance

- Required: `appId` valid format + token check pass.
- Optional: webhook probe pass.

## Artifacts and Reporting

For each run:

- `runs/<runId>/report.json`: complete machine-readable result.
- `runs/<runId>/summary.txt`: human-readable guidance.
- `runs/<runId>/artifacts/`: screenshots/traces for failed/manual steps.
- `runs/<runId>/checkpoint.json`: resumable state.

Recommended report schema fields:

- request metadata (without secrets)
- selector pack/version
- step events and durations
- extracted values (redacted as needed)
- verification outputs
- final status and remediation hints

## Migration Plan from Current Implementation

1. Keep existing `feishu:setup` command interface stable.
2. Introduce `automation/feishu-v2` behind feature flag:
   - `--engine v2` (default off initially).
3. Port current selectors into selector pack format.
4. Add checkpoint persistence and event logger.
5. Implement secret store abstraction and redaction.
6. Add verification module and final acceptance gate.
7. Enable v2 as default after soak testing.

Compatibility output mode:

- Add `--compat-output` to still emit legacy fields (`appSecret` plaintext) for temporary downstream compatibility.
- Mark as deprecated and emit warning.

## Test Plan

Unit tests:

- selector resolution and fallback ordering.
- action outcome classification.
- retry policy behavior and backoff bounds.
- redaction correctness.
- secret store adapters (mocked).

Integration tests:

- playwright mocked pages for each state transition.
- resume from checkpoint at each boundary step.
- error injection for transient UI failures.

E2E (manual-assisted):

- fresh tenant path.
- existing app path.
- permission import unavailable path.
- locale variants (zh/en).

## Operational Metrics

Capture and trend:

- setup success rate,
- median/p95 setup duration,
- manual intervention rate by step,
- selector miss rate by selector id,
- verification failure rate.

Use these metrics to prioritize selector updates and flow simplification.

## Security Checklist

- No raw secrets in logs, reports, or analytics.
- Secret access is least privilege and audited.
- Artifacts have retention policy and local-only permissions.
- Crash dumps do not include plaintext secrets.
- Compatibility mode is opt-in and time-bounded.

## Minimal API for CLI Integration

```ts
export interface FeishuSetupEngine {
  run(request: SetupRequest): Promise<SetupResult>;
  resume(runId: string): Promise<SetupResult>;
}
```

`cli/src/commands/feishuSetup.ts` should call engine methods and print:

- current status,
- artifact paths,
- exact next manual action when paused,
- final success/failure with verification status.


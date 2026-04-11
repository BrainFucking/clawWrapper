const SECRET_PATTERN = /secret_[a-zA-Z0-9_\-]+/g;
const WEBHOOK_PATTERN = /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/)([a-zA-Z0-9_\-]+)/g;
const BEARER_PATTERN = /(authorization\s*:\s*bearer\s+)([a-zA-Z0-9\.\-_]+)/gi;

export function redactText(input: string): string {
  return input
    .replaceAll(SECRET_PATTERN, "secret_***")
    .replaceAll(WEBHOOK_PATTERN, "$1***")
    .replaceAll(BEARER_PATTERN, "$1***");
}


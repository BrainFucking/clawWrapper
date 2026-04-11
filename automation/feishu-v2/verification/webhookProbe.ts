export async function runWebhookProbe(
  webhookUrl: string | undefined,
  enabled: boolean,
): Promise<"pass" | "fail" | "skipped"> {
  if (!webhookUrl || !enabled) {
    return "skipped";
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text: "clawWrapper setup verification",
        },
      }),
    });
    return response.ok ? "pass" : "fail";
  } catch {
    return "fail";
  }
}


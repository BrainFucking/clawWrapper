interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

export async function runTokenCheck(appId: string, appSecret: string | undefined): Promise<"pass" | "fail" | "skipped"> {
  if (!appId || !appSecret) {
    return "skipped";
  }
  try {
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    });
    if (!response.ok) {
      return "fail";
    }
    const data = (await response.json()) as FeishuTokenResponse;
    if (data.code === 0 && Boolean(data.tenant_access_token)) {
      return "pass";
    }
    return "fail";
  } catch {
    return "fail";
  }
}


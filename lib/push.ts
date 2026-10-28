import { createSign } from "node:crypto";

export type PushJob = { id: string; lease_id: string; notification_id: string; token: string; platform: "android" | "ios" };
export type PushResult = "sent" | "retry" | "invalid_token" | "failed";
let cachedAccess: { token: string; expires: number } | undefined;

// Never send notification title/body, case names, amounts or document names to
// FCM/APNs. The opaque notification ID is resolved under the web user's rights.
export function pushMessage(job: PushJob) {
  return { message: {
    token: job.token,
    data: { notificationId: job.notification_id },
    android: { priority: "HIGH", ttl: "3600s" },
    ...(job.platform === "ios" ? { apns: {
      headers: { "apns-push-type": "alert", "apns-priority": "10" },
      payload: { aps: { alert: { title: "Современная защита", body: "В вашем кабинете есть обновление" }, sound: "default" } },
    } } : {}),
  } };
}

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Push is not configured");
  const value = JSON.parse(raw);
  if (typeof value.project_id !== "string" || !/^[a-z0-9-]+$/.test(value.project_id)
    || typeof value.client_email !== "string" || typeof value.private_key !== "string") throw new Error("Invalid push configuration");
  return value as { project_id: string; client_email: string; private_key: string };
}
async function accessToken(account: ReturnType<typeof credentials>) {
  if (cachedAccess && cachedAccess.expires > Date.now()) return cachedAccess.token;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const assertion = `${body}.${createSign("RSA-SHA256").update(body).sign(account.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error("Push authentication failed");
  const data = await response.json();
  if (typeof data.access_token !== "string") throw new Error("Invalid push authentication response");
  cachedAccess = { token: data.access_token, expires: Date.now() + 50 * 60 * 1000 };
  return data.access_token as string;
}
export function classifyPushResponse(status: number, errorCode?: string): PushResult {
  if (status >= 200 && status < 300) return "sent";
  if (errorCode === "UNREGISTERED") return "invalid_token";
  if (status === 429 || status >= 500 || status === 401 || status === 403) return "retry";
  return "failed";
}
export async function sendPush(job: PushJob): Promise<PushResult> {
  try {
    const account = credentials();
    const token = await accessToken(account);
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(pushMessage(job)),
    });
    const data = await response.json().catch(() => ({}));
    const code = data.error?.details?.find((entry: { "@type"?: string }) => entry["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")?.errorCode;
    if (response.status === 401) cachedAccess = undefined;
    return classifyPushResponse(response.status, code);
  } catch { return "retry"; }
}

// share-customer-location
// Verify LINE ID token, then store location for only the verified customer's order.
// Supabase Dashboard setting: Verify JWT = OFF (LINE ID token is verified here).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const ALLOWED_ORIGINS = new Set(["https://cafe-order-web-admin-portal.github.io", "https://cafe-amazon-web-admin-portal.github.io"]);
const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
async function verifyLineIdToken(idToken: string, channelId: string): Promise<string> {
  const response = await fetch(LINE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  const claims = await response.json().catch(() => ({}));
  const now = Math.floor(Date.now() / 1000);
  if (!response.ok) {
    console.error("LINE Verify ID token rejected", {
      http_status: response.status,
      error: claims.error ?? null,
      error_description: claims.error_description ?? null,
    });
    throw new Error("LINE_ID_TOKEN_INVALID");
  }
  const issues: string[] = [];
  if (claims.aud !== channelId) issues.push("audience_mismatch");
  if (claims.iss !== "https://access.line.me") issues.push("issuer_mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) issues.push("subject_missing");
  if (Number(claims.exp) <= now) issues.push("token_expired");
  if (issues.length) {
    console.error("LINE ID token claim validation failed", {
      issues,
      expected_channel_id: channelId,
      received_audience: claims.aud ?? null,
      received_issuer: claims.iss ?? null,
      token_exp: claims.exp ?? null,
    });
    throw new Error("LINE_ID_TOKEN_INVALID");
  }
  return claims.sub;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return origin && ALLOWED_ORIGINS.has(origin)
      ? new Response(null, { status: 204, headers: cors(origin) })
      : reply(origin, 403, { error: "origin_not_allowed" });
  }
  if (req.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) {
    return reply(origin, 403, { error: "request_not_allowed" });
  }
  try {
    const body = await req.json();
    const idToken = typeof body?.id_token === "string" ? body.id_token.trim() : "";
    const liffId = typeof body?.liff_id === "string" ? body.liff_id.trim() : "";
    const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
    const action = typeof body?.action === "string" ? body.action : "";
    if (!idToken || idToken.length > 12000 || !/^\\d+-[A-Za-z0-9]+$/.test(liffId) || !orderId || !["start", "update", "stop"].includes(action)) {
      return reply(origin, 400, { error: "invalid_location_request" });
    }

    let latitude: number | null = null;
    let longitude: number | null = null;
    let accuracy: number | null = null;
    if (action !== "stop") {
      latitude = Number(body?.latitude);
      longitude = Number(body?.longitude);
      accuracy = body?.accuracy_m == null ? null : Number(body.accuracy_m);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return reply(origin, 400, { error: "invalid_coordinates" });
      }
      if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000)) {
        return reply(origin, 400, { error: "invalid_location_accuracy" });
      }
    }

    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: app, error: appError } = await admin
      .from("line_liff_apps").select("liff_id,line_login_channel_id")
      .eq("liff_id", liffId).eq("is_active", true).maybeSingle();
    if (appError || !app) return reply(origin, 403, { error: "LIFF นี้ยังไม่ได้ผูกกับสาขา" });

    const { data: channel, error: channelError } = await admin
      .from("line_channels").select("line_login_channel_id,branch_id")
      .eq("line_login_channel_id", app.line_login_channel_id).eq("is_active", true).maybeSingle();
    if (channelError || !channel) return reply(origin, 403, { error: "ไม่พบ LINE Channel ที่ใช้งานได้" });

    const { data: branch, error: branchError } = await admin
      .from("branches").select("id,branch_code")
      .eq("id", channel.branch_id).eq("is_active", true).maybeSingle();
    if (branchError || !branch) return reply(origin, 403, { error: "สาขาที่ผูกกับ LINE นี้ปิดให้บริการ" });

    const lineUserId = await verifyLineIdToken(idToken, channel.line_login_channel_id);
    const { data, error } = await admin.rpc("record_liff_customer_location", {
      p_line_user_id: lineUserId,
      p_order_id: orderId,
      p_branch_id: branch.id,
      p_action: action,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracy,
    });
    if (error) {
      console.error("record_liff_customer_location failed:", error.code, error.message);
      const msg = error.message || "location_save_failed";
      const status = msg.includes("does not belong") ? 403 : msg.includes("closed") ? 409 : 400;
      return reply(origin, status, { error: msg });
    }
    return reply(origin, 200, { success: true, ...(data && typeof data === "object" ? data : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("share-customer-location failed:", message);
    if (message.includes("LINE_ID_TOKEN_INVALID")) return reply(origin, 401, { error: "LINE login หมดอายุ กรุณาเข้าสู่ระบบ LINE ใหม่" });
    return reply(origin, 500, { error: "ไม่สามารถบันทึกตำแหน่งได้ในขณะนี้" });
  }
});
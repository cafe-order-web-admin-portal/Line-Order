// Public LIFF endpoint guarded by server-side LINE ID token verification.
// Dashboard setting: Verify JWT = OFF (this function verifies the LINE token itself).
import { createClient } from "npm:@supabase/supabase-js@2";

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
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
async function verifyToken(idToken: string, channelId: string) {
  const verify = await fetch(LINE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  const claims = await verify.json().catch(() => ({}));
  if (!verify.ok) {
    console.error("LINE Verify ID token rejected", {
      http_status: verify.status,
      error: claims.error ?? null,
      error_description: claims.error_description ?? null,
    });
    throw new Error("LINE_ID_TOKEN_INVALID");
  }
  const issues: string[] = [];
  if (claims.aud !== channelId) issues.push("audience_mismatch");
  if (claims.iss !== "https://access.line.me") issues.push("issuer_mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) issues.push("subject_missing");
  if (Number(claims.exp) <= Math.floor(Date.now() / 1000)) issues.push("token_expired");
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
  return claims as { sub: string };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return origin && ALLOWED_ORIGINS.has(origin) ? new Response(null, { status: 204, headers: cors(origin) }) : reply(origin, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "request_not_allowed" });
  try {
    const body = await req.json();
    const idToken = typeof body?.id_token === "string" ? body.id_token.trim() : "";
    const liffId = typeof body?.liff_id === "string" ? body.liff_id.trim() : "";
    const limit = Math.max(1, Math.min(20, Number.isInteger(body?.limit) ? body.limit : 10));
    if (!idToken || idToken.length > 12_000) return reply(origin, 400, { error: "line_id_token_required" });
    if (!/^\\d+-[A-Za-z0-9]+$/.test(liffId)) return reply(origin, 400, { error: "registered_liff_id_required" });

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
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
      .from("branches").select("id,branch_code,branch_name")
      .eq("id", channel.branch_id).eq("is_active", true).maybeSingle();
    if (branchError || !branch) return reply(origin, 403, { error: "สาขาที่ผูกกับ LINE นี้ปิดให้บริการ" });

    const claims = await verifyToken(idToken, channel.line_login_channel_id);
    const { data, error } = await admin.rpc("get_liff_orders", {
      p_line_user_id: claims.sub,
      p_branch_id: branch.id,
      p_limit: limit,
    });
    if (error) {
      console.error("get_liff_orders failed:", error.code, error.message);
      return reply(origin, 502, { error: "ไม่สามารถโหลดประวัติคำสั่งซื้อได้ในขณะนี้" });
    }
    return reply(origin, 200, { success: true, branch: { id: branch.id, branch_code: branch.branch_code, branch_name: branch.branch_name }, orders: Array.isArray(data) ? data : [] });
  } catch (error) {
    console.error("my-orders failed:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes("LINE_ID_TOKEN")) return reply(origin, 401, { error: "LINE login หมดอายุ กรุณาเปิดหน้าเว็บสั่งซื้อใหม่" });
    return reply(origin, 500, { error: "order_tracking_service_error" });
  }
});

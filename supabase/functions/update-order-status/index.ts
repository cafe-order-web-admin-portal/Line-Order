// Admin status update endpoint.
// Dashboard setting: Verify JWT = ON (default). Requires a signed-in Supabase staff user.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://cafe-order-web-admin-portal.github.io", "https://cafe-amazon-web-admin-portal.github.io"]);
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

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
function publishableKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const values = JSON.parse(raw) as Record<string, string>;
      if (values.default) return values.default;
    } catch { /* fall through */ }
  }
  throw new Error("Supabase publishable/anon key is not configured");
}
async function pushStatus(lineUserId: string, text: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) console.error("LINE status notification failed:", res.status, await res.text());
    return res.ok;
  } catch (error) {
    console.error("LINE status notification request failed:", error);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return origin && ALLOWED_ORIGINS.has(origin) ? new Response(null, { status: 204, headers: cors(origin) }) : reply(origin, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "request_not_allowed" });

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply(origin, 401, { error: "staff_session_required" });

  try {
    const body = await req.json();
    const orderId = typeof body?.order_id === "string" ? body.order_id : "";
    const newStatus = typeof body?.new_status === "string" ? body.new_status : "";
    if (!orderId || !newStatus) return reply(origin, 400, { error: "order_id_and_new_status_required" });

    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", publishableKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: userData, error: userError } = await client.auth.getUser(bearer);
    if (userError || !userData.user) return reply(origin, 401, { error: "staff_session_invalid" });

    const { data, error } = await client.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: newStatus,
    });
    if (error) {
      console.error("update_order_status RPC failed:", error.code, error.message);
      return reply(origin, 400, { error: error.message });
    }

    const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    let customerNotified = false;
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")?.trim();
    if (token && typeof result.line_user_id === "string" && result.line_user_id) {
      const labels: Record<string, string> = {
        confirmed: "ร้านยืนยันออเดอร์แล้ว",
        preparing: "บาริสต้ากำลังเตรียมเครื่องดื่มของคุณ",
        ready: "ออเดอร์พร้อมรับแล้ว กรุณาติดต่อพนักงานหน้าร้าน",
        on_the_way: "ออเดอร์กำลังจัดส่ง",
        arrived: "ไรเดอร์ถึงจุดหมายแล้ว",
        completed: "คำสั่งซื้อเสร็จสมบูรณ์ ขอบคุณที่ใช้บริการ",
        cancelled: "คำสั่งซื้อถูกยกเลิก หากมีข้อสงสัยกรุณาติดต่อร้าน",
      };
      const message = `Café Amazon ตลาดทวีสมาน ☕\nเลขที่: ${String(result.order_number ?? "-")}\n${labels[String(result.order_status)] ?? "สถานะออเดอร์มีการอัปเดต"}`;
      customerNotified = await pushStatus(result.line_user_id, message, token);
    }
    return reply(origin, 200, { success: true, ...result, customer_notified: customerNotified });
  } catch (error) {
    console.error("update-order-status failed:", error);
    return reply(origin, 500, { error: "order_status_service_error" });
  }
});

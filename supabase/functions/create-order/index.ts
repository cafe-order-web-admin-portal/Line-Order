import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://cafe-order-web-admin-portal.github.io",
  "https://cafe-amazon-web-admin-portal.github.io",
]);
const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const EXPECTED_LINE_LOGIN_CHANNEL_ID = "2012679988";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function cors(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function response(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function environment variable: ${name}`);
  return value;
}

async function verifyLineIdToken(idToken: string, channelId: string) {
  const form = new URLSearchParams({ id_token: idToken, client_id: channelId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: controller.signal,
    });
    const claims = await result.json().catch(() => ({}));
    if (!result.ok) {
      console.error("LINE Verify ID token rejected", {
        http_status: result.status,
        error: claims.error ?? null,
        error_description: claims.error_description ?? null,
      });
      throw new Error("LINE_ID_TOKEN_INVALID");
    }
    const now = Math.floor(Date.now() / 1000);
    const claimIssues: string[] = [];
    if (claims.aud !== channelId) claimIssues.push("audience_mismatch");
    if (claims.iss !== "https://access.line.me") claimIssues.push("issuer_mismatch");
    if (typeof claims.sub !== "string" || !claims.sub) claimIssues.push("subject_missing");
    if (Number(claims.exp) <= now) claimIssues.push("token_expired");
    if (claimIssues.length) {
      console.error("LINE ID token claim validation failed", {
        issues: claimIssues,
        expected_channel_id: channelId,
        received_audience: claims.aud ?? null,
        received_issuer: claims.iss ?? null,
        token_exp: claims.exp ?? null,
      });
      throw new Error("LINE_ID_TOKEN_CLAIMS_INVALID");
    }
    return claims as { sub: string; name?: string; aud: string; iss: string; exp: number };
  } finally {
    clearTimeout(timer);
  }
}

async function pushLineMessage(to: string, text: string, accessToken: string): Promise<boolean> {
  try {
    const result = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: "text", text }],
      }),
    });
    if (!result.ok) {
      console.error("LINE push message failed:", result.status, await result.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("LINE push request failed:", error);
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return response(origin, 403, { error: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method !== "POST") return response(origin, 405, { error: "method_not_allowed" });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response(origin, 403, { error: "origin_not_allowed" });

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 64_000) return response(origin, 413, { error: "request_too_large" });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
    body = parsed as Record<string, unknown>;
  } catch {
    return response(origin, 400, { error: "invalid_json" });
  }

  const idToken = typeof body.id_token === "string" ? body.id_token.trim() : "";
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  const customerNameInput = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const customerNote = typeof body.customer_note === "string" ? body.customer_note.trim() : "";
  const rawItems = body.items;

  if (!idToken || idToken.length > 12_000) return response(origin, 400, { error: "line_id_token_required" });
  if (!UUID_RE.test(requestId)) return response(origin, 400, { error: "request_id_must_be_uuid" });
  if (customerNameInput.length > 120 || phone.length > 30 || customerNote.length > 500) {
    return response(origin, 400, { error: "customer_information_too_long" });
  }
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 30) {
    return response(origin, 400, { error: "items_must_contain_1_to_30_lines" });
  }

  const items: Array<{ product_id: string; quantity: number; option_ids: string[] }> = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return response(origin, 400, { error: "invalid_item" });
    }
    const value = item as Record<string, unknown>;
    const productId = typeof value.product_id === "string" ? value.product_id : "";
    const quantity = value.quantity;
    const optionIds = value.option_ids === undefined ? [] : value.option_ids;
    if (!UUID_RE.test(productId) || !Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 50) {
      return response(origin, 400, { error: "invalid_product_or_quantity" });
    }
    if (!Array.isArray(optionIds) || optionIds.length > 12 || !optionIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      return response(origin, 400, { error: "invalid_option_ids" });
    }
    items.push({ product_id: productId, quantity: Number(quantity), option_ids: optionIds as string[] });
  }

  try {
    const lineChannelId = EXPECTED_LINE_LOGIN_CHANNEL_ID;
    // Section 14 checks auth.role() = service_role. Use the legacy service-role JWT
    // server-side so PostgREST receives the service_role role, not a publishable key.
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const lineClaims = await verifyLineIdToken(idToken, lineChannelId);
    const customerName = customerNameInput || lineClaims.name?.trim() || "LINE Customer";

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.rpc("create_liff_order", {
      p_request_id: requestId,
      p_line_user_id: lineClaims.sub,
      p_customer_name: customerName,
      p_phone: phone || null,
      p_customer_note: customerNote || null,
      p_items: items,
    });

    if (error) {
      console.error("create_liff_order failed:", error.code, error.message);
      const clientMessage = /not available|inactive|option|select|quantity|customer|branch|product/i.test(error.message)
        ? error.message
        : "ไม่สามารถสร้างคำสั่งซื้อได้ กรุณาตรวจสอบเมนูแล้วลองอีกครั้ง";
      return response(origin, 400, { success: false, error: clientMessage });
    }

    const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    let customerNotified = false;
    let staffNotified = false;

    // Notifications are best-effort; a LINE API failure must not roll back a valid order.
    if (result.success === true && result.duplicate_request !== true) {
      const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")?.trim();
      if (accessToken && lineClaims.sub) {
        const orderNumber = String(result.order_number ?? "-");
        const total = Number(result.total_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        customerNotified = await pushLineMessage(
          lineClaims.sub,
          `Café Amazon ตลาดทวีสมาน ☕\nรับคำสั่งซื้อแล้ว\nเลขที่: ${orderNumber}\nยอดรวม: ฿${total}\nสถานะ: รอยืนยันจากร้าน`,
          accessToken,
        );
        const staffRecipient = Deno.env.get("LINE_ORDER_NOTIFY_TO")?.trim();
        if (staffRecipient) {
          staffNotified = await pushLineMessage(
            staffRecipient,
            `มีคำสั่งซื้อใหม่ ☕\nเลขที่: ${orderNumber}\nลูกค้า: ${customerName}\nยอดรวม: ฿${total}\nกรุณาเปิด Order Portal เพื่อตรวจสอบ`,
            accessToken,
          );
        }
      }
    }

    return response(origin, 200, {
      ...result,
      success: result.success === true,
      notifications: { customer: customerNotified, staff: staffNotified },
    });
  } catch (error) {
    console.error("create-order request failed:", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "order_service_error";
    if (message.includes("LINE_ID_TOKEN")) return response(origin, 401, { success: false, error: "LINE login หมดอายุหรือไม่ถูกต้อง กรุณาเปิด LIFF ใหม่" });
    return response(origin, 500, { success: false, error: "ระบบสั่งซื้อยังตั้งค่าไม่ครบ กรุณาติดต่อร้าน" });
  }
});

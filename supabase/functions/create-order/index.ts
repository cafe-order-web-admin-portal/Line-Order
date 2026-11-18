import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://cafe-order-web-admin-portal.github.io",
  "https://cafe-amazon-web-admin-portal.github.io",
]);
const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const EXPECTED_LINE_LOGIN_CHANNEL_ID = "2012679988";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TRACKING_URL = "https://cafe-order-web-admin-portal.github.io/Line-Order/track-order.html";
function statusFlex(status: string, orderNumber: string, amount?: string) {
  const views: Record<string, { title: string; detail: string; icon: string; color: string; bg: string; step: number }> = {
    pending: { title: "ได้รับคำสั่งซื้อแล้ว", detail: "ร้านกำลังตรวจสอบรายการของคุณ โปรดรอการยืนยันจากพนักงาน", icon: "🕒", color: "#B86A12", bg: "#FFF3DF", step: 0 },
    confirmed: { title: "ร้านยืนยันออเดอร์แล้ว", detail: "ขอบคุณครับ ร้านรับออเดอร์เรียบร้อยแล้ว บาริสต้าจะเริ่มเตรียมเครื่องดื่มให้คุณ", icon: "✅", color: "#167347", bg: "#E8F6ED", step: 1 },
    preparing: { title: "กำลังปรุงเครื่องดื่ม", detail: "บาริสต้ากำลังตั้งใจเตรียมเครื่องดื่มแก้วโปรดของคุณ อีกไม่นานพร้อมเสิร์ฟครับ", icon: "☕", color: "#7650A8", bg: "#F2ECFA", step: 2 },
    ready: { title: "เครื่องดื่มพร้อมแล้ว!", detail: "ออเดอร์ของคุณพร้อมรับที่ร้านแล้ว กรุณาติดต่อพนักงานและแจ้งเลข Order นี้ครับ", icon: "🎉", color: "#087A49", bg: "#E5F7EC", step: 3 },
    on_the_way: { title: "กำลังจัดส่งถึงคุณ", detail: "ออเดอร์ออกเดินทางแล้ว โปรดเตรียมรับเครื่องดื่มจากพนักงานจัดส่งครับ", icon: "🛵", color: "#087C83", bg: "#E5F7F7", step: 3 },
    arrived: { title: "ไรเดอร์ถึงจุดหมายแล้ว", detail: "พนักงานจัดส่งถึงจุดหมายแล้ว กรุณาตรวจรับเครื่องดื่มของคุณครับ", icon: "📍", color: "#087C83", bg: "#E5F7F7", step: 3 },
    completed: { title: "ส่งมอบออเดอร์เรียบร้อย", detail: "ขอบคุณที่แวะมาเติมความสดชื่นกับ Café Amazon หวังว่าจะได้ดูแลคุณอีกครั้งครับ 💚", icon: "💚", color: "#167347", bg: "#E8F6ED", step: 4 },
    cancelled: { title: "คำสั่งซื้อถูกยกเลิก", detail: "ออเดอร์นี้ถูกยกเลิกแล้ว หากต้องการสอบถามรายละเอียดเพิ่มเติม กรุณาติดต่อพนักงานหน้าร้าน", icon: "✖", color: "#B33B32", bg: "#FCEDEC", step: -1 },
  };
  const v = views[status] ?? { title: "สถานะออเดอร์อัปเดตแล้ว", detail: "ตรวจสอบรายละเอียดคำสั่งซื้อได้จากปุ่มด้านล่าง", icon: "ℹ️", color: "#167347", bg: "#E8F6ED", step: 0 };
  const steps = ["รับออเดอร์", "ยืนยัน", "กำลังเตรียม", "พร้อมรับ"];
  const progress = v.step < 0 ? [] : steps.map((label, i) => ({
    type: "box", layout: "vertical", flex: 1, spacing: "xs",
    contents: [
      { type: "box", layout: "vertical", height: "5px", cornerRadius: "sm", backgroundColor: i <= Math.min(v.step, 3) ? v.color : "#E6ECE8", contents: [] },
      { type: "text", text: label, size: "xxs", color: i <= Math.min(v.step, 3) ? v.color : "#89948C", align: "center", wrap: true }
    ]
  }));
  const body: Record<string, unknown>[] = [
    { type: "text", text: "Café Amazon", size: "sm", weight: "bold", color: "#075B39" },
    { type: "text", text: v.icon + "  " + v.title, size: "xl", weight: "bold", color: v.color, wrap: true, margin: "md" },
    { type: "text", text: v.detail, size: "sm", color: "#526158", wrap: true, margin: "md" },
    { type: "separator", margin: "lg", color: "#E8EEE9" },
    { type: "text", text: "หมายเลขคำสั่งซื้อ", size: "xs", color: "#829087", margin: "lg" },
    { type: "text", text: orderNumber, size: "md", weight: "bold", color: "#173D29", wrap: true, margin: "xs" },
  ];
  if (amount) body.push({ type: "box", layout: "horizontal", margin: "md", contents: [
    { type: "text", text: "ยอดรวม", size: "sm", color: "#66736A", flex: 1 },
    { type: "text", text: amount, size: "lg", weight: "bold", color: "#087A49", align: "end" }
  ]});
  if (progress.length) body.push({ type: "box", layout: "horizontal", spacing: "xs", margin: "xl", contents: progress });
  return {
    type: "flex",
    altText: v.icon + " " + v.title + " | Order " + orderNumber,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: v.bg, contents: [
        { type: "text", text: "ORDER UPDATE  •  TALAT THAWEE SAMAN", size: "xxs", weight: "bold", color: v.color, wrap: true }
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: body },
      footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: [
        { type: "button", style: "primary", color: "#087A49", height: "md", action: { type: "uri", label: "ติดตามสถานะ Order", uri: TRACKING_URL } },
        { type: "text", text: "ขอบคุณที่ใช้บริการ Café Amazon 💚", size: "xxs", color: "#89948C", align: "center", margin: "md", wrap: true }
      ]}
    }
  };
}


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

async function pushLineMessage(to: string, message: Record<string, unknown>, accessToken: string): Promise<boolean> {
  try {
    const result = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({ to, messages: [message] }),
    });
    if (!result.ok) { console.error("LINE push message failed:", result.status, await result.text()); return false; }
    return true;
  } catch (error) { console.error("LINE push request failed:", error); return false; }
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
          statusFlex("pending", orderNumber, "฿" + total),
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
    if (message.includes("LINE_ID_TOKEN")) return response(origin, 401, { success: false, error: "LINE login หมดอายุหรือไม่ถูกต้อง กรุณาเปิดหน้าเว็บสั่งซื้อใหม่" });
    return response(origin, 500, { success: false, error: "ระบบสั่งซื้อยังตั้งค่าไม่ครบ กรุณาติดต่อร้าน" });
  }
});

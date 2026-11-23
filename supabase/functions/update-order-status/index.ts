// Admin status update endpoint.
// Dashboard setting: Verify JWT = ON (default). Requires a signed-in Supabase staff user.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://cafe-order-web-admin-portal.github.io", "https://cafe-amazon-web-admin-portal.github.io"]);
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TRACKING_URL = "https://cafe-order-web-admin-portal.github.io/Line-Order/track-order.html";
function statusFlex(status: string, orderNumber: string, amount?: string) {
  const views: Record<string, { title: string; detail: string; icon: string; color: string; bg: string; step: number }> = {
    pending: { title: "ได้รับคำสั่งซื้อแล้ว", detail: "ร้านได้รับคำสั่งซื้อแล้ว กำลังตรวจสอบรายการและเตรียมยืนยันให้คุณ กรุณารอสักครู่", icon: "🕒", color: "#B86A12", bg: "#FFF3DF", step: 0 },
    confirmed: { title: "ร้านยืนยันออเดอร์แล้ว", detail: "ร้านยืนยันคำสั่งซื้อแล้ว บาริสต้ากำลังเตรียมเครื่องดื่มให้คุณ", icon: "✅", color: "#167347", bg: "#E8F6ED", step: 1 },
    preparing: { title: "กำลังปรุงเครื่องดื่ม", detail: "บาริสต้ากำลังเตรียมเครื่องดื่มแก้วโปรดของคุณ เมื่อพร้อมรับแล้วเราจะแจ้งให้ทราบทันที", icon: "☕", color: "#7650A8", bg: "#F2ECFA", step: 2 },
    ready: { title: "เครื่องดื่มพร้อมแล้ว!", detail: "เครื่องดื่มพร้อมรับแล้ว กรุณาแจ้งหมายเลขคำสั่งซื้อกับพนักงานหน้าร้าน", icon: "🎉", color: "#087A49", bg: "#E5F7EC", step: 3 },
    on_the_way: { title: "กำลังจัดส่งถึงคุณ", detail: "คำสั่งซื้อออกจากร้านแล้ว โปรดเตรียมรับเครื่องดื่มจากพนักงานจัดส่ง", icon: "🛵", color: "#087C83", bg: "#E5F7F7", step: 3 },
    arrived: { title: "ไรเดอร์ถึงจุดหมายแล้ว", detail: "พนักงานจัดส่งถึงจุดหมายแล้ว กรุณาตรวจรับคำสั่งซื้อของคุณ", icon: "📍", color: "#087C83", bg: "#E5F7F7", step: 3 },
    completed: { title: "ส่งมอบออเดอร์เรียบร้อย", detail: "ขอบคุณที่ใช้บริการ Café Amazon หวังว่าจะได้ดูแลคุณอีกครั้งครับ 💚", icon: "💚", color: "#167347", bg: "#E8F6ED", step: 4 },
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
async function pushStatus(lineUserId: string, message: Record<string, unknown>, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: lineUserId, messages: [message] }),
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
    let admin: ReturnType<typeof createClient> | null = null;
    let orderBranchId: string | null = null;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();

    if (serviceRoleKey && supabaseUrl && typeof result.order_id === "string") {
      admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: orderMeta, error: orderMetaError } = await admin
        .from("orders").select("branch_id").eq("id", result.order_id).maybeSingle();
      if (orderMetaError) {
        console.error("Order branch lookup failed:", orderMetaError.code, orderMetaError.message);
      } else {
        orderBranchId = orderMeta?.branch_id ?? null;
      }

      if (String(result.order_status ?? newStatus) === "cancelled") {
        const { data: openPayments, error: paymentLookupError } = await admin
          .from("payment_transactions").select("id,branch_id,status")
          .eq("order_id", result.order_id).in("status", ["awaiting_payment", "rejected"]);
        if (paymentLookupError) {
          console.error("Cancelled order payment lookup failed:", paymentLookupError.code, paymentLookupError.message);
        } else if (openPayments?.length) {
          const now = new Date().toISOString();
          const ids = openPayments.map(row => row.id);
          const { error: expireError } = await admin.from("payment_transactions")
            .update({ status: "expired", updated_at: now, verification_note: "Order cancelled by store." })
            .in("id", ids).in("status", ["awaiting_payment", "rejected"]);
          if (expireError) {
            console.error("Cancelled order payment expiry failed:", expireError.code, expireError.message);
          } else {
            await admin.from("orders").update({ payment_status: "cancelled" }).eq("id", result.order_id);
            const { error: auditError } = await admin.from("payment_audit_logs").insert(openPayments.map(row => ({
              transaction_id: row.id, order_id: result.order_id, branch_id: row.branch_id,
              actor_ref: "system:order-cancelled", action_key: "payment_expired_order_cancelled",
              before_state: { status: row.status }, after_state: { status: "expired", reason: "order_cancelled" },
            })));
            if (auditError) console.error("Cancelled order payment audit failed:", auditError.code, auditError.message);
          }
        }
      }
    }

    let token = "";
    if (admin && orderBranchId) {
      const { data: configs, error: configError } = await admin.rpc("get_line_messaging_configs");
      if (configError) {
        console.error("LINE Messaging API config lookup failed:", configError.code, configError.message);
      }
      const branchConfig = Array.isArray(configs)
        ? configs.find((x: Record<string, unknown>) => String(x.branch_id) === orderBranchId)
        : null;
      token = String(branchConfig?.channel_access_token ?? "").trim()
        || (branchConfig?.use_legacy_env_credentials === true
          ? (Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")?.trim() ?? "")
          : "");
    }

    if (token && typeof result.line_user_id === "string" && result.line_user_id) {
      const amount = typeof result.total_amount === "number"
        ? "฿" + result.total_amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : undefined;
      const finalStatus = String(result.order_status ?? newStatus);
      const orderNumber = String(result.order_number ?? "-");
      const notification = statusFlex(finalStatus, orderNumber, amount);
      customerNotified = await pushStatus(result.line_user_id, notification, token);

      // Store the customer-facing notification against the branch that owns this order.
      if (customerNotified && admin && orderBranchId && typeof result.order_id === "string") {
        const eventStamp = String(result.updated_at ?? new Date().toISOString());
        const { error: chatLogError } = await admin.from("line_chat_messages").upsert({
          event_key: `order:${result.order_id}:status:${finalStatus}:${eventStamp}`,
          branch_id: orderBranchId,
          line_user_id: result.line_user_id,
          direction: "outbound",
          event_type: "order_status",
          message_type: "flex",
          message_text: String(notification.altText ?? `อัปเดตสถานะคำสั่งซื้อ ${orderNumber}: ${finalStatus}`),
          event_timestamp: new Date().toISOString(),
        }, { onConflict: "event_key", ignoreDuplicates: true });
        if (chatLogError) console.error("Order status chat history insert failed:", chatLogError.code, chatLogError.message);
      }
    }
    return reply(origin, 200, { success: true, ...result, customer_notified: customerNotified });
  } catch (error) {
    console.error("update-order-status failed:", error);
    return reply(origin, 500, { error: "order_status_service_error" });
  }
});

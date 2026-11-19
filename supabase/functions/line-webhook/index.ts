// LINE Messaging API webhook for Café Amazon ตลาดทวีสมาน.
// Dashboard setting: Verify JWT = OFF (LINE calls this endpoint without Supabase JWT).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return constantTimeEqual(toBase64(digest), signature);
}
type ChatAdmin = ReturnType<typeof createClient>;

async function recordChat(
  admin: ChatAdmin | null,
  branchId: string | null,
  entry: {
    eventKey: string;
    lineUserId: string;
    direction: "inbound" | "outbound" | "system";
    eventType: string;
    messageType?: string | null;
    messageText?: string | null;
    lineMessageId?: string | null;
    eventTimestamp?: number | null;
  },
) {
  if (!admin || !entry.lineUserId) return;
  const timestamp = Number(entry.eventTimestamp);
  const row = {
    event_key: entry.eventKey,
    branch_id: branchId,
    line_user_id: entry.lineUserId,
    direction: entry.direction,
    event_type: entry.eventType.slice(0, 40),
    message_type: entry.messageType?.slice(0, 40) ?? null,
    message_text: entry.messageText?.slice(0, 5000) ?? null,
    line_message_id: entry.lineMessageId?.slice(0, 100) ?? null,
    event_timestamp: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
  };
  const { error } = await admin.from("line_chat_messages")
    .upsert(row, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) console.error("LINE chat history insert failed:", error.code, error.message);
}

async function replyText(
  replyToken: string,
  text: string,
  accessToken: string,
  admin: ChatAdmin | null,
  branchId: string | null,
  lineUserId: string,
  eventKey: string,
  eventTimestamp?: number,
) {
  const result = await fetch(LINE_REPLY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!result.ok) {
    console.error("LINE reply failed:", result.status, await result.text());
    return;
  }
  await recordChat(admin, branchId, {
    eventKey: eventKey + ":out",
    lineUserId,
    direction: "outbound",
    eventType: "reply",
    messageType: "text",
    messageText: text,
    eventTimestamp,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("Café Amazon LINE Webhook is running", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return new Response("Webhook registry is not configured", { status: 500 });

  const admin: ChatAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: configs, error: configError } = await admin.rpc("get_line_messaging_configs");
  if (configError || !Array.isArray(configs) || configs.length === 0) {
    console.error("LINE Messaging channel registry lookup failed:", configError?.message ?? "no active configuration");
    return new Response("No active LINE channel configuration", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  if (!signature) return new Response("Invalid LINE signature", { status: 401 });

  // One endpoint supports several LINE Official Accounts. Identify the sender
  // by validating the request signature against each channel's Vault secret.
  let matchedConfig: Record<string, unknown> | null = null;
  for (const config of configs as Array<Record<string, unknown>>) {
    let candidateSecret = String(config.webhook_secret ?? "").trim();
    if (!candidateSecret && config.use_legacy_env_credentials === true) {
      candidateSecret = Deno.env.get("LINE_CHANNEL_SECRET")?.trim() ?? "";
    }
    if (!candidateSecret) continue;
    if (await verifySignature(rawBody, signature, candidateSecret)) {
      matchedConfig = config;
      break;
    }
  }
  if (!matchedConfig) return new Response("Invalid LINE signature or unregistered channel", { status: 401 });

  const branchId = String(matchedConfig.branch_id ?? "");
  const branchName = String(matchedConfig.branch_name ?? "Café Amazon");
  const liffId = String(matchedConfig.liff_id ?? "");
  const liffOrderUrl = liffId ? "https://liff.line.me/" + liffId : "";
  const accessToken = String(matchedConfig.channel_access_token ?? "").trim()
    || (matchedConfig.use_legacy_env_credentials === true
      ? (Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")?.trim() ?? "")
      : "");
  if (!branchId || !accessToken || !liffOrderUrl) {
    console.error("LINE channel matched but branch, LIFF or Messaging API token is missing:", matchedConfig.line_login_channel_id);
    return new Response("LINE channel setup is incomplete", { status: 500 });
  }

  let payload: { events?: Array<Record<string, any>> };
  try { payload = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const events = Array.isArray(payload.events) ? payload.events : [];

  for (const event of events) {
    const token = typeof event.replyToken === "string" ? event.replyToken : "";
    if (event.mode === "standby") continue;

    const lineUserId = typeof event.source?.userId === "string" ? event.source.userId : "";
    const eventKey = typeof event.webhookEventId === "string"
      ? event.webhookEventId
      : "event-" + crypto.randomUUID();

    if (event.type === "unsend" && lineUserId && typeof event.unsend?.messageId === "string" && admin) {
      // Respect LINE unsend events: remove the previously stored message content.
      const { error: unsendError } = await admin.from("line_chat_messages")
        .delete()
        .eq("line_user_id", lineUserId)
        .eq("line_message_id", event.unsend.messageId);
      if (unsendError) console.error("LINE unsend cleanup failed:", unsendError.code, unsendError.message);
    }

    if (lineUserId) {
      const incomingType = event.type === "message"
        ? String(event.message?.type ?? "unknown")
        : String(event.type ?? "event");
      await recordChat(admin, branchId, {
        eventKey: eventKey + ":in",
        lineUserId,
        direction: event.type === "message" ? "inbound" : "system",
        eventType: String(event.type ?? "event"),
        messageType: incomingType,
        messageText: event.type === "message" && event.message?.type === "text"
          ? String(event.message.text ?? "")
          : null,
        lineMessageId: typeof event.message?.id === "string" ? event.message.id : null,
        eventTimestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : null,
      });
    }

    if (!token) continue;
    if (event.type === "follow") {
      await replyText(
        token,
        `ยินดีต้อนรับสู่ ${branchName} ☕\nกดลิงก์เพื่อเลือกเมนูและสั่งซื้อได้ที่นี่\n${liffOrderUrl}`,
        accessToken, admin, branchId, lineUserId, eventKey, event.timestamp,
      );
      continue;
    }
    if (event.type === "message" && event.message?.type === "text") {
      const text = String(event.message.text ?? "").trim().toLowerCase();
      if (["เมนู", "สั่งซื้อ", "order", "menu", "ซื้อ"].some((word) => text.includes(word))) {
        await replyText(
          token,
          `เมนู ${branchName} ☕\nเปิดหน้าสั่งซื้อได้ที่นี่\n${liffOrderUrl}`,
          accessToken, admin, branchId, lineUserId, eventKey, event.timestamp,
        );
      } else {
        await replyText(
          token,
          `ขอบคุณที่ติดต่อ ${branchName} ครับ ☕\nพิมพ์ “เมนู” หรือ “สั่งซื้อ” เพื่อเปิดหน้าสั่งซื้อ\n${liffOrderUrl}`,
          accessToken, admin, branchId, lineUserId, eventKey, event.timestamp,
        );
      }
    }
  }
  return new Response("OK", { status: 200 });
});

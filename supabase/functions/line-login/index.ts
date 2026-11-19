import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CHANNEL_ID = "2012679988";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const ALLOWED_ORIGINS = new Set([
  "https://cafe-order-web-admin-portal.github.io",
  "https://cafe-amazon-web-admin-portal.github.io",
]);

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  const allowed = !!origin && ALLOWED_ORIGINS.has(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": allowed ? origin! : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}
function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required Edge Function secret: " + name);
  return value;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }});
  }
  if (req.method !== "POST") return reply(origin, 405, { error: "method_not_allowed" });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "origin_not_allowed" });

  try {
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 16000) return reply(origin, 413, { error: "request_too_large" });
    const body = await req.json();
    const idToken = typeof body?.id_token === "string" ? body.id_token.trim() : "";
    if (!idToken || idToken.length > 12000 || idToken.split(".").length !== 3) {
      return reply(origin, 400, { error: "invalid_liff_id_token" });
    }

    // Verify the LIFF-issued ID token server-side. Never trust profile data sent by the browser.
    const verifyResponse = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: CHANNEL_ID }),
    });
    const claims = await verifyResponse.json().catch(() => ({}));
    const now = Math.floor(Date.now() / 1000);
    if (!verifyResponse.ok || claims.aud !== CHANNEL_ID ||
        claims.iss !== "https://access.line.me" ||
        typeof claims.sub !== "string" || !claims.sub ||
        !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now) {
      console.error("LIFF ID token verification failed", {
        status: verifyResponse.status,
        aud: claims.aud ?? null,
        iss: claims.iss ?? null,
        hasSubject: typeof claims.sub === "string",
      });
      return reply(origin, 401, { error: "LINE ID Token ไม่ผ่านการตรวจสอบ กรุณาเปิดจาก Rich Menu ใหม่" });
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const lineUserId = claims.sub as string;
    const customerName = typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim().slice(0, 120)
      : "LINE Customer";

    const { data: existing, error: lookupError } = await admin
      .from("customers").select("id").eq("line_user_id", lineUserId).maybeSingle();
    if (lookupError) throw new Error("customer_lookup_failed");
    if (existing?.id) {
      const { error } = await admin.from("customers")
        .update({ customer_name: customerName }).eq("id", existing.id);
      if (error) throw new Error("customer_update_failed");
    } else {
      const { error } = await admin.from("customers")
        .insert({ line_user_id: lineUserId, customer_name: customerName });
      if (error && error.code === "23505") {
        const retry = await admin.from("customers").update({ customer_name: customerName })
          .eq("line_user_id", lineUserId);
        if (retry.error) throw new Error("customer_upsert_failed");
      } else if (error) {
        throw new Error("customer_insert_failed");
      }
    }

    return reply(origin, 200, {
      success: true,
      id_token: idToken,
      id_token_expires_at: Number(claims.exp) * 1000,
      profile: {
        userId: lineUserId,
        displayName: customerName,
        pictureUrl: typeof claims.picture === "string" ? claims.picture : null,
      },
    });
  } catch (error) {
    console.error("line-login failed:", error instanceof Error ? error.message : error);
    return reply(origin, 500, { error: "ไม่สามารถยืนยันบัญชี LINE ได้ กรุณาลองใหม่" });
  }
});

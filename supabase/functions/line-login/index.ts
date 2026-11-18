import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CHANNEL_ID = "2012679988";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
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
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
    const nonce = typeof body?.nonce === "string" ? body.nonce : "";
    const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
    const expectedRedirectUri = env("LINE_LOGIN_REDIRECT_URI");
    if (!code || code.length > 4096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        !/^[A-Za-z0-9_-]{20,200}$/.test(nonce) || redirectUri !== expectedRedirectUri) {
      return reply(origin, 400, { error: "invalid_login_request" });
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: expectedRedirectUri,
        client_id: CHANNEL_ID,
        client_secret: env("LINE_LOGIN_CHANNEL_SECRET"),
        code_verifier: verifier,
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenData.id_token !== "string") {
      console.error("LINE authorization-code exchange rejected", {
        status: tokenResponse.status,
        error: tokenData.error ?? null,
        error_description: tokenData.error_description ?? null,
      });
      return reply(origin, 401, { error: "LINE authorization code ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่" });
    }

    const verifyResponse = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: tokenData.id_token, client_id: CHANNEL_ID }),
    });
    const claims = await verifyResponse.json().catch(() => ({}));
    const now = Math.floor(Date.now() / 1000);
    if (!verifyResponse.ok || claims.aud !== CHANNEL_ID ||
        claims.iss !== "https://access.line.me" ||
        typeof claims.sub !== "string" || !claims.sub ||
        Number(claims.exp) <= now ||
        typeof claims.nonce !== "string" || !constantTimeEqual(claims.nonce, nonce)) {
      console.error("LINE ID token verification failed", {
        status: verifyResponse.status,
        aud: claims.aud ?? null,
        iss: claims.iss ?? null,
        hasSubject: typeof claims.sub === "string",
        nonceMatched: typeof claims.nonce === "string" && constantTimeEqual(claims.nonce, nonce),
      });
      return reply(origin, 401, { error: "LINE ID Token ไม่ผ่านการตรวจสอบ กรุณาเข้าสู่ระบบใหม่" });
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const lineUserId = claims.sub as string;
    const customerName = typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim().slice(0, 120)
      : "LINE Customer";

    // Update only the display name for existing customers; never overwrite their phone.
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
      id_token: tokenData.id_token,
      expires_in: Number(tokenData.expires_in) || 3600,
      profile: {
        userId: lineUserId,
        displayName: customerName,
        pictureUrl: typeof claims.picture === "string" ? claims.picture : null,
      },
    });
  } catch (error) {
    console.error("line-login failed:", error instanceof Error ? error.message : error);
    return reply(origin, 500, { error: "ระบบ LINE Login ยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ" });
  }
});

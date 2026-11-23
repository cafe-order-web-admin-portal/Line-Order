import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const QR_IMAGE_URL = "https://cafe-order-web-admin-portal.github.io/Line-Order/assets/promptpay-qr.png";
const ALLOWED_ORIGINS = new Set([
  "https://cafe-order-web-admin-portal.github.io",
  "https://cafe-amazon-web-admin-portal.github.io",
]);
const MAX_SLIP_BYTES = 5 * 1024 * 1024;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Obj = Record<string, unknown>;
const cors = (origin: string | null): HeadersInit => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});
const reply = (origin: string | null, status: number, data: Obj) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const amount = (v: unknown) => Math.round(Number(v) * 100) / 100;

async function verifyLineToken(idToken: string, channelId: string) {
  const form = new URLSearchParams({ id_token: idToken, client_id: channelId });
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error("LINE_ID_TOKEN_INVALID");
  const claims = await res.json();
  if (!claims.sub || claims.aud !== channelId) throw new Error("LINE_ID_TOKEN_INVALID");
  return claims as { sub: string; name?: string };
}


async function resolveLineOaUrl(branchId: string, liffId: string): Promise<string | null> {
  const { data: app } = await admin.from("line_liff_apps").select("line_login_channel_id")
    .eq("liff_id", liffId).eq("is_active", true).maybeSingle();
  if (!app?.line_login_channel_id) return null;
  const { data: configs } = await admin.rpc("get_line_messaging_configs");
  if (!Array.isArray(configs)) return null;
  const config = (configs as Array<Record<string, unknown>>).find(x =>
    String(x.branch_id ?? "") === branchId && String(x.line_login_channel_id ?? "") === String(app.line_login_channel_id)
  );
  if (!config) return null;
  const accessToken = String(config.channel_access_token ?? "").trim()
    || (config.use_legacy_env_credentials === true ? (Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "").trim() : "");
  if (!accessToken) return null;
  const response = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: "Bearer " + accessToken } });
  if (!response.ok) return null;
  const info = await response.json();
  const basicId = String(info.basicId ?? "").trim();
  return basicId ? "https://line.me/R/ti/p/" + basicId : null;
}

async function customerContext(body: Obj) {
  const idToken = str(body.id_token, 12000);
  const liffId = str(body.liff_id, 80);
  const orderId = str(body.order_id, 80);
  if (!idToken || !/^\d+-[A-Za-z0-9]+$/.test(liffId) || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    throw new Error("ข้อมูลยืนยันตัวตนหรือ Order ไม่ถูกต้อง");
  }

  const { data: app, error: appErr } = await admin.from("line_liff_apps")
    .select("liff_id,line_login_channel_id")
    .eq("liff_id", liffId).eq("is_active", true).maybeSingle();
  if (appErr || !app) throw new Error("LIFF นี้ยังไม่ได้ลงทะเบียนใช้งาน");
  const { data: channel, error: channelErr } = await admin.from("line_channels")
    .select("line_login_channel_id,branch_id")
    .eq("line_login_channel_id", app.line_login_channel_id).eq("is_active", true).maybeSingle();
  if (channelErr || !channel) throw new Error("ไม่พบ LINE Channel ที่ใช้งาน");
  const claims = await verifyLineToken(idToken, channel.line_login_channel_id);

  const { data: order, error: orderErr } = await admin.from("orders")
    .select("id,order_number,branch_id,customer_id,total_amount,order_status,created_at")
    .eq("id", orderId).eq("branch_id", channel.branch_id).maybeSingle();
  if (orderErr || !order) throw new Error("ไม่พบคำสั่งซื้อหรือไม่ตรงกับ LINE สาขานี้");
  if (order.order_status === "cancelled") throw new Error("คำสั่งซื้อนี้ถูกยกเลิกแล้ว");
  const { data: customer, error: customerErr } = await admin.from("customers")
    .select("id,line_user_id,customer_name")
    .eq("id", order.customer_id).maybeSingle();
  if (customerErr || !customer || customer.line_user_id !== claims.sub) {
    throw new Error("ไม่สามารถยืนยันเจ้าของคำสั่งซื้อนี้ได้");
  }
  return { claims, order, customer };
}

async function requireAdmin(req: Request, branchId?: string) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new Error("ADMIN_SESSION_REQUIRED");
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData.user) throw new Error("ADMIN_SESSION_INVALID");
  const { data: staff, error: staffErr } = await admin.from("staff")
    .select("id,auth_user_id,branch_id,staff_name,role,is_active")
    .eq("auth_user_id", authData.user.id).eq("is_active", true).maybeSingle();
  if (staffErr || !staff || !["super_admin", "manager"].includes(staff.role)) {
    throw new Error("PAYMENT_ADMIN_ACCESS_DENIED");
  }
  const selectedBranch = staff.role === "super_admin" ? str(branchId, 80) : String(staff.branch_id ?? "");
  if (!selectedBranch) throw new Error("BRANCH_REQUIRED");
  if (staff.role !== "super_admin" && branchId && branchId !== selectedBranch) {
    throw new Error("BRANCH_SCOPE_DENIED");
  }
  return { user: authData.user, staff, branchId: selectedBranch };
}

async function signedSlip(path: string | null) {
  if (!path) return null;
  const { data, error } = await admin.storage.from("payment-proofs").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

async function handle(body: Obj, req: Request): Promise<Obj> {
  const action = str(body.action, 80);

  if (action === "customer-init") {
    const { claims, order, customer } = await customerContext(body);
    const { data: settings, error: settingsErr } = await admin.from("payment_settings")
      .select("*").eq("branch_id", order.branch_id).maybeSingle();
    if (settingsErr || !settings) throw new Error("ยังไม่ได้ตั้งค่าการรับชำระเงินของสาขา");
    if (!settings.qr_payment_enabled) {
      return { success: true, enabled: false, message: settings.offline_message || "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า" };
    }

    let { data: tx, error: txErr } = await admin.from("payment_transactions")
      .select("*").eq("order_id", order.id).maybeSingle();
    if (txErr) throw txErr;
    if (!tx) {
      const { data: inserted, error: insertErr } = await admin.from("payment_transactions")
        .insert({
          order_id: order.id, branch_id: order.branch_id, order_number: order.order_number,
          customer_name: customer.customer_name || claims.name || "LINE Customer",
          customer_line_user_id: claims.sub, expected_amount: amount(order.total_amount),
          status: "awaiting_payment",
        }).select("*").single();
      if (insertErr) throw insertErr;
      tx = inserted;
      await admin.from("payment_audit_logs").insert({
        transaction_id: tx.id, order_id: order.id, branch_id: order.branch_id,
        actor_ref: "customer:" + claims.sub, action_key: "payment_session_created",
        after_state: { status: tx.status, expected_amount: tx.expected_amount },
      });
    }
    if (tx.status === "matched") {
      return { success: true, enabled: true, already_paid: true, transaction_id: tx.id, amount: tx.expected_amount };
    }
    const lineOaUrl = await resolveLineOaUrl(order.branch_id, str(body.liff_id, 80));
    return {
      success: true, enabled: true, transaction_id: tx.id, amount: tx.expected_amount,
      qr_image_url: settings.qr_image_url || QR_IMAGE_URL,
      customer_message: settings.customer_message || "กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ",
      require_slip: settings.require_slip !== false,
      status: tx.status, line_oa_url: lineOaUrl,
      offline_message: settings.offline_message || "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า",
      note: "ร้านจะตรวจสอบการชำระเงินก่อนยืนยันสถานะ Paid",
    };
  }

  if (action === "customer-update-order") {
    const { claims, order } = await customerContext(body);
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 30) {
      throw new Error("กรุณาเลือกสินค้า 1 ถึง 30 รายการ");
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const items = rawItems.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("รายการสินค้าไม่ถูกต้อง");
      const item = raw as Obj;
      const productId = str(item.product_id, 80);
      const quantity = Number(item.quantity);
      const optionIds = item.option_ids === undefined ? [] : item.option_ids;
      if (!uuidPattern.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        throw new Error("รหัสสินค้าหรือจำนวนสินค้าไม่ถูกต้อง");
      }
      if (!Array.isArray(optionIds) || optionIds.length > 12 || !optionIds.every((id) => typeof id === "string" && uuidPattern.test(id))) {
        throw new Error("ตัวเลือกสินค้าไม่ถูกต้อง");
      }
      return { product_id: productId, quantity, option_ids: optionIds as string[] };
    });
    const { data: updated, error: updateError } = await admin.rpc("update_liff_order_before_payment", {
      p_order_id: order.id,
      p_line_user_id: claims.sub,
      p_items: items,
    });
    if (updateError || !updated?.success) {
      throw new Error(updateError?.message || "ไม่สามารถแก้ไขคำสั่งซื้อได้ กรุณาตรวจสอบสถานะการชำระเงิน");
    }
    const [{ data: tx, error: txError }, { data: settings, error: settingsError }] = await Promise.all([
      admin.from("payment_transactions").select("*").eq("order_id", order.id)
        .eq("customer_line_user_id", claims.sub).maybeSingle(),
      admin.from("payment_settings").select("*").eq("branch_id", order.branch_id).maybeSingle(),
    ]);
    if (txError || !tx || tx.status !== "awaiting_payment") throw new Error("สถานะการชำระเงินเปลี่ยนแปลงแล้ว กรุณารีเฟรชหน้า");
    if (settingsError || !settings || settings.qr_payment_enabled !== true) throw new Error("สาขานี้ปิดรับชำระเงิน QR แล้ว");
    const lineOaUrl = await resolveLineOaUrl(order.branch_id, str(body.liff_id, 80));
    return {
      success: true,
      order: updated,
      payment: {
        success: true, enabled: true, transaction_id: tx.id, amount: tx.expected_amount,
        qr_image_url: settings.qr_image_url || QR_IMAGE_URL,
        customer_message: settings.customer_message || "กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ",
        require_slip: settings.require_slip !== false, status: tx.status, line_oa_url: lineOaUrl,
        offline_message: settings.offline_message || "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า",
        note: "ร้านจะตรวจสอบการชำระเงินก่อนยืนยันสถานะ Paid",
      },
    };
  }

  if (action === "customer-submit-proof") {
    const { claims, order } = await customerContext(body);
    const transactionId = str(body.transaction_id, 80);
    const mime = str(body.mime_type, 80).toLowerCase();
    const base64 = str(body.file_base64, 7_000_000);
    const reference = str(body.transfer_reference, 140);
    const transferAt = str(body.transfer_at, 80);
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(mime) || !base64) throw new Error("กรุณาแนบสลิปเป็น JPG, PNG หรือ WebP");
    const { data: tx, error: txErr } = await admin.from("payment_transactions")
      .select("*").eq("id", transactionId).eq("order_id", order.id).maybeSingle();
    if (txErr || !tx || tx.customer_line_user_id !== claims.sub) throw new Error("ไม่พบรายการชำระเงินนี้");
    if (tx.status === "matched") throw new Error("รายการนี้ตรวจสอบและยืนยันการชำระเงินแล้ว");
    const bytes = Uint8Array.from(atob(base64.replace(/^data:[^,]+,/, "")), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length > MAX_SLIP_BYTES) throw new Error("ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const slipHash = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
    const { data: duplicateSlip, error: duplicateSlipErr } = await admin.from("payment_transactions")
      .select("id,order_number").eq("slip_sha256", slipHash).neq("id", tx.id).maybeSingle();
    if (duplicateSlipErr) throw duplicateSlipErr;
    if (duplicateSlip) throw new Error("ภาพสลิปนี้ถูกส่งใช้กับ Order " + duplicateSlip.order_number + " แล้ว");
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
    const path = order.branch_id + "/" + order.id + "/" + crypto.randomUUID() + "." + ext;
    const { error: uploadErr } = await admin.storage.from("payment-proofs").upload(path, bytes, {
      contentType: mime, upsert: false, cacheControl: "3600",
    });
    if (uploadErr) throw uploadErr;
    const before = { status: tx.status, slip_path: tx.slip_path };
    const { error: updateErr } = await admin.from("payment_transactions").update({
      status: "submitted", slip_path: path, slip_sha256: slipHash, transfer_reference: reference || null,
      transfer_at: transferAt ? new Date(transferAt).toISOString() : null,
      submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      verification_note: null, paid_amount: null, verified_by: null, verified_at: null,
    }).eq("id", tx.id);
    if (updateErr) throw updateErr;
    const { error: orderUpdateErr } = await admin.from("orders").update({ payment_status: "pending_verification" }).eq("id", order.id);
    if (orderUpdateErr) throw orderUpdateErr;
    await admin.from("payment_audit_logs").insert({
      transaction_id: tx.id, order_id: order.id, branch_id: order.branch_id,
      actor_ref: "customer:" + claims.sub, action_key: "proof_submitted",
      before_state: before, after_state: { status: "submitted", transfer_reference: reference || null },
    });
    return { success: true, status: "submitted", message: "รับสลิปแล้ว ร้านจะตรวจสอบยอดเงินก่อนยืนยันการชำระเงิน" };
  }

  const branchIdInput = str(body.branch_id, 80);
  const ctx = await requireAdmin(req, branchIdInput || undefined);

  if (action === "admin-upload-qr") {
    const ctx = await requireAdmin(req, str(body.branch_id, 80) || undefined);
    const mime = str(body.mime_type, 80).toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("รองรับไฟล์ PNG / JPG / WebP เท่านั้น");
    const encoded = str(body.file_base64, 8 * 1024 * 1024);
    if (!encoded || encoded.length > 7 * 1024 * 1024) throw new Error("ไฟล์ QR ใหญ่เกิน 5 MB");
    const binary = atob(encoded);
    if (!binary.length || binary.length > MAX_SLIP_BYTES) throw new Error("ไฟล์ QR ใหญ่เกิน 5 MB");
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
    const path = ctx.branchId + "/" + crypto.randomUUID() + "." + ext;
    const { error: uploadError } = await admin.storage.from("payment-qr").upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "3600" });
    if (uploadError) throw uploadError;
    const { data: publicData } = admin.storage.from("payment-qr").getPublicUrl(path);
    const qrUrl = publicData.publicUrl;
    const { data: before } = await admin.from("payment_settings").select("*").eq("branch_id", ctx.branchId).maybeSingle();
    const payload = {
      branch_id: ctx.branchId, qr_payment_enabled: before?.qr_payment_enabled === true,
      qr_image_url: qrUrl, customer_message: before?.customer_message || "กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ",
      offline_message: "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า",
      payment_timeout_minutes: before?.payment_timeout_minutes || 20, require_slip: before?.require_slip !== false,
      updated_by: ctx.user.id, updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("payment_settings").upsert(payload, { onConflict: "branch_id" }).select("*").single();
    if (error) throw error;
    await admin.from("payment_audit_logs").insert({
      transaction_id: null, order_id: null, branch_id: ctx.branchId,
      actor_ref: ctx.user.id, action_key: "payment_qr_image_updated",
      before_state: before, after_state: { qr_image_url: qrUrl },
    });
    return { success: true, qr_image_url: qrUrl, settings: data };
  }

  if (action === "admin-get-settings") {
    const { data, error } = await admin.from("payment_settings").select("*").eq("branch_id", ctx.branchId).maybeSingle();
    if (error) throw error;
    return { success: true, settings: data || {
      branch_id: ctx.branchId, qr_payment_enabled: false, qr_image_url: QR_IMAGE_URL,
      customer_message: "กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ",
      offline_message: "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า",
      payment_timeout_minutes: 20, require_slip: true,
    } };
  }

  if (action === "admin-save-settings") {
    const qrEnabled = body.qr_payment_enabled === true;
    const qrUrl = str(body.qr_image_url || QR_IMAGE_URL, 1000);
    const allowedQrPrefix = SUPABASE_URL + "/storage/v1/object/public/payment-qr/";
    if (!qrUrl.startsWith("https://cafe-order-web-admin-portal.github.io/Line-Order/") && !qrUrl.startsWith(allowedQrPrefix)) {
      throw new Error("QR image URL ไม่ใช่ไฟล์ QR ที่ระบบอนุญาต");
    }
    const { data: before } = await admin.from("payment_settings").select("*").eq("branch_id", ctx.branchId).maybeSingle();
    const payload = {
      branch_id: ctx.branchId, qr_payment_enabled: qrEnabled, qr_image_url: qrUrl,
      customer_message: str(body.customer_message || "กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ", 500),
      offline_message: "ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า",
      payment_timeout_minutes: Math.min(240, Math.max(5, Number(body.payment_timeout_minutes || 20))),
      require_slip: body.require_slip !== false, updated_by: ctx.user.id, updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("payment_settings").upsert(payload, { onConflict: "branch_id" }).select("*").single();
    if (error) throw error;
    await admin.from("payment_audit_logs").insert({
      transaction_id: null, order_id: null, branch_id: ctx.branchId,
      actor_ref: ctx.user.id, action_key: "payment_settings_updated",
      before_state: before, after_state: data,
    });
    return { success: true, settings: data };
  }

  if (action === "admin-list") {
    const status = str(body.status, 40);
    let query = admin.from("payment_transactions").select("*,orders:orders(order_status,payment_status,total_amount,created_at)")
      .eq("branch_id", ctx.branchId).order("created_at", { ascending: false }).limit(250);
    if (status && status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const transactionRows = data || [];
    const transactionIds = transactionRows.map(row => row.id);
    let lineSubmittedIds = new Set<string>();
    if (transactionIds.length) {
      const { data: lineEvents, error: lineEventsErr } = await admin.from("payment_audit_logs")
        .select("transaction_id").in("transaction_id", transactionIds)
        .eq("action_key", "proof_submitted_via_line");
      if (lineEventsErr) throw lineEventsErr;
      lineSubmittedIds = new Set((lineEvents || []).map(event => String(event.transaction_id)));
    }
    const rows = await Promise.all(transactionRows.map(async row => ({
      ...row,
      submission_source: lineSubmittedIds.has(String(row.id)) ? "line_oa" : row.slip_path ? "web_upload" : null,
      slip_url: await signedSlip(row.slip_path),
    })));
    return { success: true, transactions: rows };
  }

  if (action === "admin-detail") {
    const id = str(body.transaction_id, 80);
    const { data: row, error } = await admin.from("payment_transactions").select("*")
      .eq("id", id).eq("branch_id", ctx.branchId).maybeSingle();
    if (error || !row) throw new Error("ไม่พบ Transaction");
    const [{ data: audit, error: auditErr }, slipUrl] = await Promise.all([
      admin.from("payment_audit_logs").select("*").eq("transaction_id", id).order("created_at", { ascending: false }),
      signedSlip(row.slip_path),
    ]);
    if (auditErr) throw auditErr;
    const submittedViaLine = (audit || []).some(event => event.action_key === "proof_submitted_via_line");
    return {
      success: true,
      transaction: {
        ...row,
        submission_source: submittedViaLine ? "line_oa" : row.slip_path ? "web_upload" : null,
        slip_url: slipUrl,
      },
      audit: audit || [],
    };
  }

  if (action === "admin-review") {
    const id = str(body.transaction_id, 80);
    const decision = str(body.decision, 30);
    const note = str(body.note, 1000);
    const actualPaid = amount(body.paid_amount);
    const transferRef = str(body.transfer_reference, 140);
    if (!["matched", "rejected", "needs_review"].includes(decision)) throw new Error("สถานะตรวจสอบไม่ถูกต้อง");
    const { data: tx, error: txErr } = await admin.from("payment_transactions").select("*")
      .eq("id", id).eq("branch_id", ctx.branchId).maybeSingle();
    if (txErr || !tx) throw new Error("ไม่พบ Transaction");
    if (!["submitted", "needs_review", "rejected"].includes(tx.status)) throw new Error("รายการนี้ยังไม่มีสลิปให้ตรวจสอบ");
    if (decision === "matched") {
      if (!Number.isFinite(actualPaid) || actualPaid <= 0 || actualPaid !== amount(tx.expected_amount)) {
        throw new Error("ยอดเงินจริงต้องตรงกับยอด Order ทุกสตางค์ก่อนยืนยัน Paid");
      }
      if (transferRef) {
        const { data: duplicate, error: duplicateErr } = await admin.from("payment_transactions")
          .select("id,order_number").eq("transfer_reference", transferRef).neq("id", id).maybeSingle();
        if (duplicateErr) throw duplicateErr;
        if (duplicate) throw new Error("เลขอ้างอิงธุรกรรมนี้ถูกใช้กับ Order " + duplicate.order_number + " แล้ว");
      }
    }
    const before = { status: tx.status, paid_amount: tx.paid_amount, verification_note: tx.verification_note };
    const updates: Obj = {
      status: decision, verification_note: note || null, updated_at: new Date().toISOString(),
      verified_by: ctx.user.id, verified_at: new Date().toISOString(),
    };
    if (decision === "matched") {
      updates.paid_amount = actualPaid;
      if (transferRef) updates.transfer_reference = transferRef;
    } else {
      updates.paid_amount = null;
    }
    const { error: updateTxErr } = await admin.from("payment_transactions").update(updates).eq("id", id);
    if (updateTxErr) throw updateTxErr;
    const paymentStatus = decision === "matched" ? "paid" : decision === "rejected" ? "unpaid" : "pending_verification";
    const { error: updateOrderErr } = await admin.from("orders").update({ payment_status: paymentStatus }).eq("id", tx.order_id);
    if (updateOrderErr) throw updateOrderErr;
    await admin.from("payment_audit_logs").insert({
      transaction_id: id, order_id: tx.order_id, branch_id: tx.branch_id,
      actor_ref: ctx.user.id, action_key: "payment_" + decision,
      before_state: before, after_state: { status: decision, paid_amount: decision === "matched" ? actualPaid : null, note },
    });
    return { success: true, status: decision, payment_status: paymentStatus };
  }

  throw new Error("UNKNOWN_ACTION");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) {
    return reply(origin, 403, { success: false, error: "origin_not_allowed" });
  }
  try {
    const raw = await req.text();
    if (raw.length > 8_000_000) return reply(origin, 413, { success: false, error: "request_too_large" });
    const body = JSON.parse(raw) as Obj;
    const result = await handle(body, req);
    return reply(origin, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "payment_service_error";
    const status = message.includes("SESSION") || message.includes("ACCESS_DENIED") || message.includes("SCOPE_DENIED") || message.includes("LINE_ID_TOKEN_INVALID") ? 401 : 400;
    console.error("payment-portal:", message);
    return reply(origin, status, { success: false, error: message });
  }
});

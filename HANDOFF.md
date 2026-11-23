# HANDOFF — Line-Order Payment Operations

Updated: 2026-11-23 (รอบ 2 · Claude)

## Current deployment
- Supabase project: `ytxbnqosenolojifeikf`
- `payment-portal`: **v19** ACTIVE
- `line-webhook`: **v38** ACTIVE
- `update-order-status`: v21 ACTIVE

> **สำคัญ — ซอร์สใน `supabase/functions/` เคยล้าหลังของจริงมาก** (payment-portal 689 บรรทัด ขณะที่ v18 มี 886, line-webhook 445 ขณะที่ v37 มี 488)
> รอบนี้ซิงก์ให้ตรงกับที่ deploy จริงแล้วทั้งคู่ · **ก่อน deploy ทุกครั้ง ให้ดึงของจริงด้วย `get_edge_function` มาเทียบก่อน**
> ไม่งั้นมีโอกาสเอาโค้ดเก่าทับงานที่แก้ไว้ (เกือบเกิดขึ้นมาแล้ว)

## รอบ 2 — แก้สลิปโอนสำเร็จแต่ LINE ตอบว่าไม่ผ่าน + แจ้งลูกค้าเมื่อตรวจผ่าน
ต้นเหตุ 2 ชั้น: ธนาคาร (โดยเฉพาะกรุงเทพ) เผยแพร่รายการโอนช้ากว่าสลิปหลายสิบวินาที → EasySlip ตอบ `SLIP_PENDING`/`SLIP_NOT_FOUND` (404)
และ `matchedAccount` จะมีก็ต่อเมื่อผูกบัญชีรับเงินในแดชบอร์ด EasySlip แล้วเท่านั้น · โค้ดเดิมนับทั้งสองกรณีเป็น "สลิปผิด" แล้วปฏิเสธเงินที่ลูกค้าโอนมาแล้ว

- **หลักการ: ข้อมูลไม่ครบ ≠ สลิปปลอม** — แยกผลเป็น `rejected` / `needs_review` / `matched` แทน 2 ทาง
  - `rejected` เฉพาะที่ EasySlip บอกชัด (สลิปซ้ำ / ยอดไม่ตรง / `isAccountMatched===false` / สลิปไม่ถูกต้อง / วันเวลาโอนผิด)
  - `needs_review` = สลิปจริงแต่ข้อมูลไม่พอให้ยืนยันแทนคน → รอร้านกดยืนยัน ไม่ตัดเงินลูกค้าทิ้ง
- ยิง EasySlip ซ้ำเองเมื่อธนาคารยังไม่เผยแพร่ (payment-portal 4 ครั้ง · line-webhook 3 ครั้ง เพราะ LINE ต้องได้คำตอบเร็ว) · เลิกบอกลูกค้าว่า "กรุณาส่งสลิปอีกครั้ง"
- **ตรรกะ `runAutoSlipVerification` ซ้ำกันทั้ง 2 ฟังก์ชัน — แก้ตัวเดียวไม่พอ** มีเคสจริงที่ line-webhook พักรอถูกต้องแล้ว แต่ตัวตรวจซ้ำของ payment-portal (ยังเป็นรุ่นเก่า) ปฏิเสธทับในอีก 2 นาที
- **แจ้งลูกค้าทาง LINE เมื่อตรวจผ่านอัตโนมัติ** (`pushLineText()` ใน payment-portal v19) — ใช้ Push API เพราะ `replyToken` ของ webhook หมดอายุไปแล้วตอนผลตรวจจริงมา
  เจ้าของกำหนด: **แจ้งเฉพาะกรณีตรวจผ่าน** ไม่แจ้งตอนไม่ผ่าน ตอนร้านกดเอง หรือตอนหมดเวลา · push ล้มเหลวไม่ทำให้การยืนยันเงินล้ม · ไม่บันทึก LINE user id ลง log
  Push นับโควตาข้อความของ LINE OA (reply ไม่นับ) — ออเดอร์เยอะต้องดูแพ็กเกจ
- **ตัวตรวจซ้ำเบื้องหลัง `payment-portal?__retry=1` ไม่ได้อยู่ใน `cron.job`** มีตัวเรียกจากข้างนอกยิงทุกนาที (ยืนยันด้วย `CRON_KEY`) → แก้พฤติกรรมมันต้อง deploy โค้ดเท่านั้น
- ทดสอบจริง 2 รอบด้วยเงินจริง (B0001-261123105318-D0F9AD): โอน → ส่งสลิป → พักรอ → ตรวจซ้ำผ่านเอง → แจ้ง LINE รวม **ไม่ถึง 2 นาที** ไม่ต้องให้ร้านกดอะไร

## รอบ 3 — ปรับลำดับ LINE OA แจ้งเตือนหลังยืนยัน Order (2026-11-23)

- Production Edge Function `create-order` deployed **v27 ACTIVE**.
- Removed only the immediate customer LINE OA `pending/order_created` push after LIFF order creation. This avoids notifying the customer before the LIFF payment step is completed.
- Staff new-order LINE push via `LINE_ORDER_NOTIFY_TO` remains unchanged.
- Order creation still calls `create_liff_order`; no payment function, QR, slip, EasySlip, payment transaction, or payment-status logic was changed.
- LIFF button progress copy changed from `กำลังส่งคำสั่งซื้อ…` to `ระบบกำลังพาไปหน้าชำระเงิน…` in PR #28. This UI change is pending merge/deployment.
- **Source-sync warning:** the live `create-order` v26 source was retrieved and used as the exact deployment baseline for v27. The corresponding source file was not found at the expected `supabase/functions/create-order/index.ts` path in the repository. Before any future deploy, first add/sync the live v27 source into the canonical repository path and compare it against production; do not deploy an older local copy.
- Static post-deploy checks: customer pending push absent; staff notification remains; `create_liff_order` call remains; function status ACTIVE v27. No test order/payment was created.

## รอบ 2 — แก้ UI ตามที่เจ้าของแจ้ง
1. **ข้อความตอนรับสลิป** เปลี่ยนเป็น "ได้รับข้อมูลสลิปชำระเงินเรียบร้อยแล้ว ตรวจสอบข้อมูลสักครู่" (ต่อท้ายด้วย `(Order …)` เหมือนเดิม) — `line-webhook` v38
2. **ปุ่มบันทึกรูป QR** ในหน้าชำระเงินของลูกค้า (`cafe-amazon-liff-index.html` → `saveQrImage()`)
   เบราว์เซอร์ใน LINE มักไม่รองรับ attribute `download` → ลองดาวน์โหลดเป็น blob ก่อน ถ้าไม่ได้จึงเปิดรูปเต็มจอให้กดค้างบันทึกเอง · ล้มเหลวอย่างไรก็ไม่กระทบการชำระเงิน
3. **เมนู QR Payment กดไม่ติด / หุบเอง** (`assets/app.js`)
   - ต้นเหตุ: ผูก `onclick` ให้ `#payment-nav-toggle` **ซ้อนกัน 2 ที่** — ตัวใน `bindPaymentEvents` เขียนทับตัวใน `bindNavEvents`
     ตัวที่ทับสลับแค่ `sub.hidden` ไม่แตะ `state.paymentNavExpanded` → พอหน้า Payment วาดใหม่ (รีเฟรชเองทุก 5 วินาที) เมนูอ่าน state เดิมแล้ว **หุบเอง** และลูกศรไม่เคยเปลี่ยน
   - แก้: เอาตัวที่ผูกซ้ำออก เหลือที่เดียว · **อย่าผูก handler ให้ปุ่มนี้ซ้ำอีก**
   - แก้เพิ่ม: หน้า Payment จะวาดใหม่เฉพาะตอนข้อมูลเปลี่ยนจริง (`paymentRenderSignature()`) เดิมวาดใหม่ทุก 5 วินาทีแม้ข้อมูลเท่าเดิม ทำให้ปุ่มถูกสร้างใหม่กลางคันจน **กดไม่ติด**
     ลายเซ็นไม่รวม `slip_url` (เป็นลิงก์เซ็นชื่อที่เปลี่ยนทุกครั้ง) แต่ใส่ช่วงเวลา 10 นาทีไว้ต่ออายุลิงก์ก่อนหมดอายุจริง 1 ชั่วโมง
   - bump `index.html` เป็น `assets/app.js?v=1.2.6`

## Validation (รอบ 2)
- `node --check` ผ่านทั้ง `assets/app.js` และสคริปต์ใน `cafe-amazon-liff-index.html`
- ทดสอบเมนูด้วย Chromium เทียบโค้ดเก่า/ใหม่ 7 ข้อผ่านหมด — โค้ดเก่าทำอาการ "หุบเองหลังวาดใหม่" ซ้ำได้จริง โค้ดใหม่: กด=กาง · วาดใหม่แล้วยังกาง · กดอีก=ย่อ
- ทดสอบ `paymentRenderSignature()` 3 ข้อผ่าน (ลิงก์สลิปเปลี่ยนอย่างเดียวไม่วาดใหม่ · สถานะเปลี่ยนวาดใหม่ · เปลี่ยนหน้าวาดใหม่)
- ซอร์ส `payment-portal` v19 / `line-webhook` v38 ในรีโปตรงกับที่ deploy จริงทุกตัวอักษร

## ค้างอยู่ / ให้เจ้าของตัดสิน
- `payment_settings.payment_timeout_minutes` = **20 นาที** ส่วนข้อความถึงลูกค้าขอให้ชำระ **ภายใน 5 นาที** (ตั้งใจให้ 20 เป็นกันชน) · แก้ข้อความได้ในหลังร้าน > Payment Settings
- เคสที่ตกมาเป็น `needs_review` ถ้าร้านไม่กดยืนยันภายใน 20 นาที ออเดอร์จะถูกยกเลิกเอง

---

## รอบ 1 (เดิม)

### Changes
1. QR Payment Settings now supports selecting and saving a branch-specific PromptPay QR image. Uploads are stored in the public `payment-qr` bucket; the saved URL is written to `payment_settings.qr_image_url`.
2. Fixed the payment page event binder recursion and connected it to the normal page event binding. This restores Payment Settings and Transactions interactions.
3. LINE slip matching now excludes cancelled and completed orders. Cancelling an order expires its still-open `awaiting_payment` / `rejected` transaction and records an audit event.
4. Added a QR Payment queue to LIVE ORDERS, with payment status visible on each order card and all payment transactions accessible even when their related order is cancelled.
5. The six historical B0001 transactions for the tested LINE customer whose orders were already cancelled were changed from `awaiting_payment` to `expired`. Their order records remain cancelled; no payment was marked as received.

### Validation
- LIVE ORDERS inline JavaScript syntax: passed.
- Web Admin Portal `assets/app.js` syntax: passed.
- Payment Portal, LINE Webhook and Update Order Status deployed and ACTIVE.
- Verified the six cancelled-order payment sessions are now `expired`.
- No customer order or bank payment was created as part of the code test.

### Remaining manual validation
- Open Web Admin Portal > Payment Settings, upload a known-good PromptPay QR image, press **บันทึก QR**, then reload and verify it persists.
- Open LIVE ORDERS > **QR Payment** and verify all transaction rows display.
- Create one new test order, confirm **รอชำระเงิน** appears in LIVE ORDERS, send the transfer slip in LINE OA, and confirm it appears in the payment queue as **รอตรวจสอบสลิป**. Staff must still verify the real bank credit before marking Paid.

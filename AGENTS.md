# AGENTS.md — Line-Order (ระบบออเดอร์ Café Amazon)

อ่านไฟล์นี้ก่อนแก้โค้ดหรือฐานข้อมูล — ใช้ร่วมกันระหว่าง AI ทุกตัว (ChatGPT/Codex, Claude) และคน
ระบบนี้เชื่อมกับ **หลังร้าน CMS** (repo `centralized-store-management-system/CMS`) บน Supabase project เดียวกัน
`cafe-amazon-order-management` (ref `ytxbnqosenolojifeikf`) — แก้ผิดจุดจะถูกซิงก์ทับหรือทำให้อีกระบบพัง

## ใครเป็นเจ้าของข้อมูล (สำคัญที่สุด)
| ข้อมูล | เจ้าของ (แก้ที่นี่) | ระบบนี้ |
|---|---|---|
| สาขา: รหัส ชื่อ เปิด/ปิด ที่อยู่ โทร พิกัด (`public.branches`) | CMS — แอป Owner > สาขา / เว็บหลังร้าน > Settings | **อ่านอย่างเดียว** ซิงก์ทับทุกครั้งที่หลังร้านเปลี่ยน (≤ 1 นาที) |
| พนักงานที่ใช้ระบบออเดอร์ (`public.staff` ที่มี `cms_ref`, Supabase Auth user) | CMS — User Management + สิทธิ์ `orders` / `catalog` | **ห้ามสร้าง/แก้/ลบเอง** ซิงก์อัตโนมัติ |
| สินค้า หมวด ตัวเลือก ราคารายสาขา (`products`, `branch_products`, ...) | ระบบนี้ (Web Admin Portal) | เจ้าของ |
| ออเดอร์ ลูกค้า ตำแหน่ง แชต LINE ลูกค้า, LINE channel registry | ระบบนี้ | เจ้าของ |

## จุดเชื่อมกับ CMS (ห้ามลบ/เปลี่ยนชื่อ)
- `public.branches.cms_code` — รหัสสาขาใน CMS (เช่น `B0001`, คั่น `,` ได้). ตอนนี้ `branch_code` = รหัส CMS เดียวกัน (`B0001`; เดิม `PKT001`)
  - ห้ามเขียนรหัสสาขาตายตัวในโค้ด ให้อ่านจากตาราง / LINE channel registry. ถ้าจำเป็นต้องมีค่า fallback ให้ใช้ `B0001`
  - เลขออเดอร์ขึ้นต้นด้วย `branch_code` จริง (`B0001-YYMMDDhhmmss-XXXXXX`); ออเดอร์เก่าขึ้นต้น `PKT001` คงไว้
  - เปลี่ยน id ของสาขาไม่ได้ (`line_channels.branch_id`, `branch_products`, `orders`, `staff` อ้าง id) — ซิงก์แก้แบบ update ในแถวเดิม
- `public.staff.cms_ref` — `owner` | `u:<CMS user id>` (unique). บัญชีจาก CMS ใช้อีเมลภายใน `cms-…@cms.cafe-amazon.local` ไม่มีรหัสผ่าน
  - Role: CMS Owner/Admin → `super_admin` · Manager/HR → `manager` · Staff → `staff`. ปิดใน CMS = `is_active=false` + ban auth user
  - บัญชีที่ไม่มี `cms_ref` = สร้างนอกหลังร้าน → ระบบ IT ของ CMS ขึ้นเตือน
- **SSO จากหลังร้าน**: `assets/sso.js` (โหลดใน `index.html`, `orders.html` ต่อจาก `config.js`) รับ `#sso=<token_hash>` → `verifyOtp(magiclink)` → reload
  และ `#sso_error=<ข้อความ>`. หลังร้านเปิดลิงก์ผ่าน `…/functions/v1/backoffice?__order=<ตั๋ว>` (ตั๋วใช้ครั้งเดียว 90 วิ)
  - ห้ามเอา `sso.js` ออก / ห้ามเปลี่ยน storage key ของ supabase-js / ถ้าย้ายหน้า admin ให้ใส่ `sso.js` ด้วย
- Edge Function **`backoffice`** = เซิร์ฟเวอร์ของ CMS (ห้ามแก้/deploy ทับจาก repo นี้). มันทำงานทุกนาทีผ่าน pg_cron `backoffice-tick`:
  ซิงก์สาขา+พนักงาน และอ่านสุขภาพระบบออเดอร์ (ส่งเข้า "ระบบ IT" ของแอป Owner):
  ออเดอร์ `order_status='pending'` เกิน 10 นาที, ping (OPTIONS) ฟังก์ชัน `create-order, line-webhook, update-order-status, my-orders, line-login, share-customer-location` ทุก 30 นาที
  - ถ้าเปลี่ยนชื่อฟังก์ชัน / ค่า `order_status` / ชื่อคอลัมน์ `branches` / `staff` / `orders.created_at` ต้องแจ้งให้แก้ `CMS/server/order-link.js` ด้วย
- Schema `backoffice` และ Storage `backoffice`, `backoffice-public` เป็นของ CMS — ห้ามแตะ

## Supabase
- Migrations ใช้ชื่อ snake_case ผ่าน `apply_migration`; เก็บสำเนา SQL ใน repo ได้ แต่ฐานข้อมูลจริงคือแหล่งความจริง (`list_migrations`)
- RPC สร้างออเดอร์: `create_liff_order(..., p_branch_code text)` (เวอร์ชัน 6 อาร์กิวเมนต์เก่ายังอยู่ — fallback สาขา `B0001`)
- RLS เปิดทุกตาราง public; ฟังก์ชัน SECURITY DEFINER ใส่ `SET search_path = ''`

## เวลาแก้งาน
- ดึงโค้ดล่าสุดก่อนเสมอ (`git pull --rebase`) — มีหลาย AI ส่งงานเข้า `main` วันเดียวกันหลายรอบ
- งานใหม่แยกไฟล์ แก้ไฟล์เดิมเท่าที่จำเป็น · ตอบ/คอมเมนต์ภาษาไทยได้
- อย่าใส่ข้อมูลลับ (service role key, LINE secret) ในไฟล์ — ใช้ Edge Function secrets / Vault

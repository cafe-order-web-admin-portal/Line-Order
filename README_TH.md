# Café Amazon Web Admin Portal

Web Admin Portal สำหรับจัดการ Product Catalog, ราคาประจำสาขา, ความพร้อมจำหน่าย, รูปสินค้า และ Import History โดยใช้ Supabase เป็น backend

## สถานะของชุดนี้
- เป็น Web Portal รุ่นเริ่มต้นแบบ Static Web App (ไฟล์ HTML/CSS/JS)
- เชื่อมต่อ Supabase ด้วย `supabase-js 2.119.0`
- รองรับไฟล์ Excel `.xlsx`, `.xls` และ CSV
- มีหน้า Login, Dashboard, Product Management, Category Management, Import, Import History
- ยังไม่ใช่เว็บไซต์ที่ Deploy หรือเชื่อมกับ Project จริงจนกว่าจะตั้งค่า Project URL / Publishable Key และติดตั้ง SQL security

## ไฟล์
- `index.html` — หน้าเว็บหลัก
- `assets/app.css` — รูปแบบหน้าจอ
- `assets/config.js` — ตั้งค่า Project URL และ Publishable Key สำหรับ deployment (ไม่แสดงฟอร์มให้ผู้เข้าชมแก้ไข)
- `assets/app.js` — ระบบ Login / CRUD / Import / Export Template
- `setup_portal_security.sql` — สร้าง import_history, RLS policies, grants และ Storage bucket
- `README_TH.md` — คู่มือภาษาไทย
- `product_import_template.csv` — Template สำหรับ Super Admin
- `price_import_template.csv` — Template สำหรับ Manager

## ติดตั้งกับ Supabase
1. เปิด Supabase Project ที่มีตารางฐานข้อมูล Café Amazon อยู่แล้ว
2. เปิด SQL Editor แล้ว Run ไฟล์ `setup_portal_security.sql`
3. ตรวจสอบว่าใน Settings > API / Integrations เปิด Data API สำหรับ schema `public` และตารางที่ Portal ใช้งาน:
   - `staff`, `branches`, `categories`, `products`, `branch_products`
   - `import_history`
   - `product_option_groups`, `product_options`, `product_option_group_products`, `product_option_product_options`
4. สร้างผู้ใช้งานผ่าน Authentication > Users > Add user / Invite user ด้วย Email
5. นำ User ID จาก Auth Users ไปผูกใน `public.staff.auth_user_id` (ใช้ SQL Editor ใน Dashboard)

ตัวอย่างเพิ่ม Super Admin ให้สาขา PKT001:
```sql
INSERT INTO public.staff (auth_user_id, branch_id, staff_name, role, is_active)
VALUES (
  'ใส่-Auth-User-UUID',
  (SELECT id FROM public.branches WHERE branch_code = 'PKT001'),
  'ชื่อผู้ดูแล',
  'super_admin',
  TRUE
);
```

ตัวอย่างผูก Auth User กับ Staff row เดิม:
```sql
UPDATE public.staff
SET auth_user_id = 'ใส่-Auth-User-UUID', is_active = TRUE
WHERE id = 'ใส่-Staff-Row-UUID';
```

## สิทธิ์
- `super_admin`: จัดการหมวดหมู่และสินค้า (global), ราคา/สถานะทุกสาขา, Import catalog + branch price, อัปโหลดรูปสินค้า
- `manager`: ดู Catalog, แก้ราคาและเปิด/ปิดขายเฉพาะสาขาที่ผูก, Import ราคา/availability ของสาขาตัวเอง
- `staff`: อ่านข้อมูลตามสาขา (read-only)

สิทธิ์ที่แท้จริงถูกบังคับด้วย PostgreSQL grants + RLS policies ใน SQL ไม่ได้อาศัยการซ่อนปุ่มบนหน้าเว็บเท่านั้น

## ตั้งค่าหน้า Web
1. เปิด `index.html` ผ่าน HTTPS Hosting (เช่น GitHub Pages หรือ Static Hosting)
2. ก่อน Deploy ให้แก้ไฟล์ `assets/config.js` แล้วใส่ Project URL และ Publishable Key ของโปรเจกต์
3. Deploy แล้ว Login ด้วย Email/Password จาก Supabase Auth

**ห้ามนำ service_role / secret key ใส่หน้าเว็บเด็ดขาด**

## การนำเข้า
### Super Admin
ใช้ `CafeAmazon_Product_Import_Template.xlsx` ที่ดาวน์โหลดจากหน้าเว็บ หรือไฟล์ CSV โดยมีคอลัมน์:
`branch_code, product_code, product_name, category_name, description, price, is_available, is_active, is_featured, display_order, image_url`

### Manager
ใช้ `CafeAmazon_Price_Import_Template.xlsx` มีคอลัมน์:
`branch_code, product_code, price, is_available`

- เลือกสาขาบนหน้าเว็บก่อน Preview/Import
- `price` ว่าง = คงราคาเดิม; หากยังไม่มีราคา ระบบเริ่มที่ 0
- `is_available` ว่าง = คงสถานะเดิม; หากยังไม่มีค่า ระบบปิดขาย
- ห้ามเปิดขายพร้อมราคา 0 บาท
- รหัสสินค้าซ้ำในไฟล์เดียวกันจะถูกแจ้งเป็นข้อผิดพลาด
- ระบบ Preview ก่อนบันทึก และบันทึกผลใน `import_history`

## รูปสินค้า
- เก็บใน Supabase Storage bucket `product-images`
- Bucket ตั้ง Public เพื่อให้หน้าร้าน/LINE สามารถแสดงภาพเมนูได้
- Upload / Update / Delete ทำได้เฉพาะ `super_admin`
- รองรับ JPEG, PNG, WebP ขนาดไม่เกิน 5 MB

## ข้อจำกัด/หมายเหตุ
- ระบบนี้ยังไม่เชื่อมกับ CMS เดิมตามที่พักไว้
- ระบบนี้ไม่เชื่อม POS Café Amazon อัตโนมัติ
- ชื่อสินค้า 40 รายการที่มีในฐานข้อมูลปัจจุบันเป็น Starter Catalog ต้องตรวจสอบความถูกต้อง ราคา ขนาด และรายการที่ขายจริงในสาขาก่อนเปิดใช้งาน
- ไม่ควรเปิดสินค้าให้ลูกค้าเห็นจนกว่าจะกำหนดราคาและสถานะสาขาถูกต้อง

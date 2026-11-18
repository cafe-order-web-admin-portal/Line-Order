CAFE AMAZON - LIVE ORDER MONITOR / STORE OPERATION DASHBOARD
Version: UI V2 - 18 Nov 2026
Branch: Café Amazon ตลาดทวีสมาน (PKT001)

วัตถุประสงค์ของเวอร์ชันนี้
--------------------------
ปรับหน้า Staff Dashboard ให้มีรูปแบบตามภาพอ้างอิงล่าสุดของผู้ใช้:
- แถบ Header สีเขียว พร้อมสถานะ LIVE, สาขา, วันเวลา และลิงก์ WEB ADMIN
- KPI 6 ช่อง: ออเดอร์วันนี้, ยอดขายวันนี้, รอรับออเดอร์,
  กำลังเตรียม, พร้อมรับสินค้า, สำเร็จแล้ววันนี้
- แผนที่ติดตามลูกค้าด้านซ้าย แสดง Marker รูปคน + เลขออเดอร์
  สี Marker แยกแต่ละออเดอร์ และแสดง GPS Updated / Location Stale / Offline
- ด้านขวาเป็น LIVE ORDERS เรียงจากออเดอร์ใหม่ไปเก่า
  มีรายการ NEW ORDER ขนาดใหญ่ด้านบน และรายการถัดไปแบบ Compact
- มีปุ่มยืนยัน / เริ่มเตรียม / พร้อมรับ / ส่งมอบ ตามลำดับสถานะ
  ปุ่มที่ยังไม่ถึงขั้นตอนจะถูกปิดไว้ ป้องกันการข้ามสถานะ
- มี SOUND ON/OFF สำหรับเสียงแจ้งเตือนเมื่อมี Order ใหม่
- แถบล่างสรุป Total Orders / Pending / Completed
- Responsive สำหรับจอคอมพิวเตอร์และแท็บเล็ตแนวนอน

การแยกหน้าจอ
-------------
1) orders.html = Staff Dashboard เท่านั้น
   พนักงานเข้าสู่ระบบด้วย Supabase Auth และต้องเป็น Active staff
   Dashboard เห็นเฉพาะออเดอร์และข้อมูลสาขาที่บัญชีพนักงานผูกไว้
2) cafe-amazon-liff-index.html = Customer LIFF เท่านั้น
   ลูกค้าสั่งซื้อ ดูสถานะออเดอร์ตัวเอง และเลือกกดยินยอมแชร์ GPS เอง
   ลูกค้าไม่เห็นแผนที่หรือ Staff Dashboard
3) index.html = Web Admin Portal เดิม
   เวอร์ชันนี้ไม่แก้ไข index.html และไม่เปลี่ยนระบบ Web Admin เดิม
   ปุ่ม WEB ADMIN บน Dashboard จะพากลับไป ./index.html

ไฟล์ใน Package
---------------
orders.html
    Staff Dashboard เวอร์ชัน UI V2
cafe-amazon-liff-index.html
    Customer LIFF เวอร์ชันที่มีปุ่มแชร์ / หยุดแชร์ GPS
CAFE_AMAZON_ORDER_MANAGEMENT.sql
    Master SQL ไฟล์เดียว รวม Section เดิม 1-24
assets/cafe-amazon-logo.jpg
    โลโก้ที่ใช้บน Dashboard
Shop Marker ในแผนที่สร้างด้วย inline SVG ภายใน orders.html ไม่ต้องเพิ่มไฟล์รูปแยก
supabase/functions/share-customer-location/index.ts
    Edge Function ตรวจสอบ LINE ID Token และรับพิกัด GPS
supabase/functions/update-order-status/index.ts
    Edge Function เปลี่ยนสถานะออเดอร์และส่ง LINE notification (ถ้ามี Token)

ข้อสำคัญก่อนติดตั้ง
------------------
- ห้ามเปลี่ยนชื่อ cafe-amazon-liff-index.html
- ห้ามเปลี่ยน LIFF ID: 2012679988-ORHhLD7I
- ห้ามเปลี่ยน LIFF Endpoint URL เดิม
- ไม่ต้องแก้ index.html หรือ assets/config.js เดิม
- assets/config.js ต้องอยู่ในตำแหน่งเดิมและมี Supabase URL / Publishable Key
- ห้ามนำ Supabase service_role key ไปใส่ในไฟล์ HTML หรือ GitHub Pages

A) GitHub Pages - อัปเดตหน้า Dashboard
-------------------------------------
Repository: cafe-amazon-web-admin-portal/Line-Order
ให้อัปโหลดและ Commit ไฟล์ดังนี้:
1. แทนที่ orders.html ที่ Root ด้วย orders.html จาก Package
2. เพิ่มไฟล์ assets/cafe-amazon-logo.jpg ในโฟลเดอร์ assets เดิม
3. หากต้องการให้หน้า LIFF รับ GPS ตามเวอร์ชันใน Package ให้แทนที่
   cafe-amazon-liff-index.html ที่ Root ด้วยไฟล์จาก Package
4. ไม่ต้องแก้ไข index.html, assets/config.js หรือไฟล์อื่นของ Web Admin

B) Supabase SQL - ใช้ Master SQL ไฟล์เดียว
-----------------------------------------
Master SQL มี Section 1-24 รวมอยู่ในไฟล์เดียว
- หากฐานข้อมูลใช้งานอยู่แล้วและเคย Run Section 24 สำเร็จแล้ว:
  ไม่ต้องรัน SQL ซ้ำ เพราะการปรับครั้งนี้เป็นการปรับหน้าแสดงผล Dashboard
  ไม่ได้เพิ่มหรือลบตารางในฐานข้อมูล
- หากสร้างฐานข้อมูล Sections 1-23 แล้ว แต่ยังไม่เคย Run Section 24:
  เปิด CAFE_AMAZON_ORDER_MANAGEMENT.sql แล้ว Run เฉพาะ Section 24
  ชื่อ Section: LIVE ORDER DASHBOARD - STAFF SCOPE + REALTIME + ONE-CLICK
- ห้าม Run Master SQL ทั้งไฟล์ซ้ำบนฐานข้อมูลที่มีข้อมูลใช้งานจริง

หลัง Run Section 24 ให้ตรวจสอบผลลัพธ์ท้าย Section:
1. มี Policies สำหรับ orders, order_items, customers,
   order_status_history, customer_locations และ customer_location_shares
2. Supabase Realtime Publication มีตาราง orders และ customer_location_shares
3. มี public.update_order_status(UUID, TEXT)

C) Supabase Edge Functions
--------------------------
1. share-customer-location
   Source: supabase/functions/share-customer-location/index.ts
   - Function name: share-customer-location
   - Verify JWT: OFF
   - เหตุผล: Function ตรวจสอบ LINE ID Token ผ่าน LINE Verify endpoint เอง
   - ตรวจสอบ Secret LINE_LOGIN_CHANNEL_ID = 2012679988
   - Function ใช้ SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY จาก Environment
     ของ Supabase Edge Functions เท่านั้น ห้ามใส่ Secret ในหน้าเว็บ

2. update-order-status
   Source: supabase/functions/update-order-status/index.ts
   - Function name: update-order-status
   - Verify JWT: ON
   - ต้องใช้ Supabase Auth session ของพนักงาน
   - หาก Function ที่ใช้งานอยู่ทำงานปกติ ไม่จำเป็นต้อง Deploy ทับอีกครั้ง
   - หากต้อง Deploy ใหม่ ให้ใช้ไฟล์ Source ใน Package และคง Verify JWT = ON
   - LINE_CHANNEL_ACCESS_TOKEN ใช้สำหรับส่งข้อความเปลี่ยนสถานะให้ลูกค้า

D) บัญชีพนักงาน
----------------
พนักงานทุกคนที่จะเปิด Dashboard ต้องมี:
- Supabase Auth User
- public.staff.auth_user_id ตรงกับ Auth User ID
- public.staff.branch_id ตรงกับสาขา PKT001
- public.staff.is_active = TRUE

ไม่มีการแบ่ง Manager / Staff / Super Admin สำหรับปุ่มรับออเดอร์และเปลี่ยนสถานะ
แต่ยังคงต้อง Login และต้องเป็นพนักงาน Active เพื่อป้องกันบุคคลทั่วไปเห็นข้อมูลลูกค้า

E) ตั้งค่าพิกัดร้าน
------------------
ตั้งค่าพิกัดร้านใน public.branches สำหรับสาขา PKT001 แล้ว:
Latitude 7.9153428, Longitude 98.3717597
Dashboard ใช้พิกัดนี้สร้าง Shop Marker แบบไอคอนหน้าร้าน Café Amazon
และวาดเส้นประเชื่อมจากตำแหน่งลูกค้าที่กำลังแชร์ GPS
ระยะทางบน Marker เป็นระยะเส้นตรงโดยประมาณ ไม่ใช่ระยะทางขับรถหรือเส้นทางนำทาง

F) ทดสอบการทำงาน
----------------
1. เปิดหน้า orders.html และ Login ด้วยบัญชีพนักงาน
2. กด SOUND OFF ให้เป็น SOUND ON หนึ่งครั้ง เพื่ออนุญาต Browser เล่นเสียง
   Browser บางชนิดไม่อนุญาตเสียงอัตโนมัติก่อนมี User Interaction
3. สร้างออเดอร์ทดสอบใหม่จาก Customer LIFF
4. ตรวจสอบว่า Order ปรากฏเป็น NEW ORDER บนด้านขวาและมีเสียงแจ้งเตือน
5. กด Confirm Order -> Start Preparing -> Order Ready
   และ Complete Order เมื่อส่งมอบสินค้าแล้ว
6. ลูกค้าต้องกดยินยอมแชร์ GPS จากหน้า LIFF เอง จึงจะแสดง Marker บนแผนที่

พฤติกรรม GPS และความเป็นส่วนตัว
--------------------------------
- ลูกค้าเลือกกดยินยอมแชร์ GPS เอง และสามารถหยุดแชร์ได้ทุกเมื่อ
- GPS ส่งข้อมูลขณะหน้า LIFF ยังเปิดทำงานและอุปกรณ์อนุญาต Location เท่านั้น
  การปิดหน้า LIFF, สลับแอป หรือพักหน้าจอ อาจทำให้การส่ง GPS หยุด
- หากไม่มี GPS ใหม่เกิน 120 วินาที แสดง Location Stale
- หากหยุดแชร์ แสดง Offline พร้อมเวลาของพิกัดล่าสุด
- ออเดอร์ Completed / Cancelled จะถูกนำออกจากแผนที่
- Dashboard ไม่ตีความพิกัดเก่าว่าเป็นตำแหน่งปัจจุบัน
- ไม่เปิดเผยพิกัดหรือแผนที่ให้ลูกค้าคนอื่นเห็น

ข้อจำกัดของ Report
------------------
Dashboard ดึง 300 ออเดอร์ล่าสุดของสาขามาแสดงและคำนวณ KPI จากชุดข้อมูลที่โหลด
หากจำนวนออเดอร์เกิน 300 รายการในช่วงที่ต้องการสรุป ควรเพิ่ม Server-side
Summary / Pagination เป็นงานพัฒนารอบถัดไป เพื่อให้ตัวเลข Report ครบถ้วนทุก Order

สถานะการ Deploy
---------------
ไฟล์ใน Package เป็น Source สำหรับอัปโหลดและ Deploy ด้วยตนเอง
การสร้าง Package ไม่ได้เปลี่ยน GitHub Pages หรือ Supabase โดยอัตโนมัติ
หลังอัปโหลด/Deploy ต้องทดสอบด้วย Order จริงก่อนเปิดใช้งานประจำร้าน
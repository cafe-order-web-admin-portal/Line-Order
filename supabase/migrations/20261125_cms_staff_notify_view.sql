-- สำเนา migration `cms_staff_notify_view` (ฐานข้อมูลจริงคือแหล่งความจริง — ดู list_migrations)
--
-- view นี้ให้ Edge Function ฝั่งระบบออเดอร์ (payment-portal, line-webhook) อ่าน "ใครขอรับแจ้งเตือน LINE"
-- ได้โดยไม่ต้องทำตารางซ้ำ ไม่ต้องมี cron ซิงก์ และไม่ต้องแก้ Edge Function `backoffice` ของ CMS
--
-- เจ้าของข้อมูลยังเป็น CMS 100%: อ่านตรงจากชีต "ผู้ใช้ระบบ (Users)" ใน schema backoffice
-- เจ้าของติ๊กช่อง "แจ้งเตือน LINE" ในหลังร้าน > ผู้ใช้ => มีผลทันที ไม่ต้อง deploy อะไร
--
-- อ่านหัวตารางด้วย "ชื่อคอลัมน์" ไม่ใช่ลำดับคอลัมน์ => สลับ/แทรกคอลัมน์ในชีตแล้วไม่พัง
-- ถ้า "เปลี่ยนชื่อ" หัวคอลัมน์ในชีต (รหัสระบบ / ชื่อที่แสดง / สถานะ / LINE ID / แจ้งเตือน LINE)
-- view จะคืน 0 แถว => แจ้งเตือนเงียบ ต้องมาแก้ชื่อตรงนี้ด้วย
--
-- คีย์ events ที่ฝั่งเซิร์ฟเวอร์ใช้ตอนนี้: 'pay' (ชำระเงินสำเร็จ/ไม่สำเร็จ) · '*' = รับทุกเหตุการณ์
-- ตัวเลือกในหน้าเว็บอยู่ที่ CMS/js/line-events-order.js — เปลี่ยนคีย์ต้องแก้ทั้งสองฝั่ง

create or replace view public.cms_staff_notify as
with head as (
  select book, sheet, vals as h
    from backoffice.rows
   where sheet = 'ผู้ใช้ระบบ (Users)' and r = 1
), idx as (
  select book, sheet,
    (select (ord - 1)::int from jsonb_array_elements_text(h) with ordinality t(v, ord)
      where btrim(v) = 'รหัสระบบ' limit 1) as i_id,
    (select (ord - 1)::int from jsonb_array_elements_text(h) with ordinality t(v, ord)
      where btrim(v) = 'ชื่อที่แสดง' limit 1) as i_name,
    (select (ord - 1)::int from jsonb_array_elements_text(h) with ordinality t(v, ord)
      where btrim(v) = 'สถานะ' limit 1) as i_status,
    (select (ord - 1)::int from jsonb_array_elements_text(h) with ordinality t(v, ord)
      where btrim(v) = 'LINE ID' limit 1) as i_line,
    (select (ord - 1)::int from jsonb_array_elements_text(h) with ordinality t(v, ord)
      where btrim(v) = 'แจ้งเตือน LINE' limit 1) as i_events
    from head
)
select
  'u:' || btrim(r.vals ->> i.i_id) as cms_ref,
  btrim(r.vals ->> i.i_line) as line_user_id,
  nullif(btrim(coalesce(r.vals ->> i.i_name, '')), '') as display_name,
  coalesce((select array_agg(btrim(e)) from unnest(string_to_array(coalesce(r.vals ->> i.i_events, ''), ',')) e
             where btrim(e) <> ''), '{}'::text[]) as events,
  coalesce(btrim(r.vals ->> i.i_status), '') <> 'disabled' as is_active
  from backoffice.rows r
  join idx i on i.book = r.book and i.sheet = r.sheet
 where r.r > 1
   and i.i_id is not null and i.i_line is not null and i.i_events is not null
   and btrim(coalesce(r.vals ->> i.i_id, '')) <> ''
   and btrim(coalesce(r.vals ->> i.i_line, '')) ~ '^U[0-9a-f]{32}$'
union all
-- บัญชีเจ้าของไม่ได้อยู่ในชีตผู้ใช้ เก็บไว้ใน props OWNER_PROFILE
select
  'owner' as cms_ref,
  btrim(p.j ->> 'lineUserId') as line_user_id,
  nullif(btrim(coalesce(p.j ->> 'name', '')), '') as display_name,
  coalesce((select array_agg(btrim(e)) from unnest(string_to_array(coalesce(p.j ->> 'lineEvents', ''), ',')) e
             where btrim(e) <> ''), '{}'::text[]) as events,
  true as is_active
  from (select case when v ~ '^\s*\{' then v::jsonb else null::jsonb end as j
          from backoffice.kv where ns = 'props' and k = 'OWNER_PROFILE') p
 where p.j is not null
   and btrim(coalesce(p.j ->> 'lineUserId', '')) ~ '^U[0-9a-f]{32}$';

-- LINE user id ของพนักงาน = ข้อมูลส่วนตัว อ่านได้เฉพาะ service_role (Edge Function) เท่านั้น
revoke all on public.cms_staff_notify from anon, authenticated, public;
grant select on public.cms_staff_notify to service_role;

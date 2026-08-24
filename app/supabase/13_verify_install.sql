-- ============================================================================
-- ตรวจว่ารันไฟล์ SQL ครบแล้วหรือยัง (อ่านเท่านั้น ไม่แก้อะไรเลย รันซ้ำได้)
--
-- ทำไมต้องมีไฟล์นี้: ไฟล์หลัง ๆ บางไฟล์เพิ่มคอลัมน์ที่ฟังก์ชันในไฟล์ก่อนหน้าเรียกใช้
--   ถ้าลืมรันไฟล์ใดไฟล์หนึ่ง ระบบจะดูเหมือนปกติ แต่จะพังตอนใช้งานจริง เช่น
--   ลืม 10_manage_tender.sql → กดยื่นราคาแล้วขึ้น record "v_t" has no field "cancelled_at"
--   ลืม 11_link_users.sql    → บัญชีใหม่ไม่โผล่ในหน้า "ผู้ใช้และผู้ขาย"
--
-- อ่านผล: แถวที่ขึ้น ❌ ให้ไปรันไฟล์ในคอลัมน์ "ต้องรันไฟล์" แล้วรันไฟล์นี้อีกครั้ง
--   cat ~/Desktop/supplier-bidding/app/supabase/13_verify_install.sql | pbcopy
-- ============================================================================

select
  case when e.ok then '✅ ครบ' else '❌ ขาด' end            as "ผล",
  e.kind || ' ' || e.name                                   as "สิ่งที่ตรวจ",
  e.file                                                    as "ต้องรันไฟล์"
from (
  select v.kind, v.name, v.file, v.want,
         (case v.kind
            when 'ฟังก์ชัน' then exists (
              select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = v.name)
            when 'ตาราง' then exists (
              select 1 from information_schema.tables
              where table_schema = 'public' and table_name = v.name)
            else exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name  = split_part(v.name, '.', 1)
                and column_name = split_part(v.name, '.', 2))
          end) = v.want as ok
  from (values
    -- โครงหลัก
    ('ตาราง',    'suppliers',                        '01_schema.sql',        true),
    ('ตาราง',    'profiles',                         '01_schema.sql',        true),
    ('ตาราง',    'tenders',                          '01_schema.sql',        true),
    ('ตาราง',    'tender_internal',                  '01_schema.sql',        true),
    ('ตาราง',    'bids',                             '01_schema.sql',        true),
    ('คอลัมน์',  'profiles.must_change_password',    '01_schema.sql',        true),
    ('ฟังก์ชัน', 'tender_status',                    '01_schema.sql',        true),
    ('ฟังก์ชัน', 'is_buyer',                         '02_rls.sql',           true),
    ('ฟังก์ชัน', 'can_see_prices',                   '02_rls.sql',           true),
    ('ฟังก์ชัน', 'next_tender_code',                 '03_functions.sql',     true),
    ('ฟังก์ชัน', 'create_tender',                    '03_functions.sql',     true),
    ('ฟังก์ชัน', 'submit_bid',                       '03_functions.sql',     true),
    ('ฟังก์ชัน', 'unseal_tender',                    '03_functions.sql',     true),
    ('ฟังก์ชัน', 'award_bid',                        '03_functions.sql',     true),
    ('ฟังก์ชัน', 'hammer_holder',                    '03_functions.sql',     true),
    ('ฟังก์ชัน', 'my_hammer_state',                  '03_functions.sql',     true),
    ('ฟังก์ชัน', 'attach_bid_files',                 '03_functions.sql',     true),
    ('ฟังก์ชัน', 'try_uuid',                         '04_storage.sql',       true),
    -- ผู้ดูแล / รหัสผ่าน
    ('ตาราง',    'admin_actions',                    '07_admin.sql',         true),
    ('ฟังก์ชัน', 'admin_list_users',                 '07_admin.sql',         true),
    ('ฟังก์ชัน', 'admin_set_supplier_password',      '07_admin.sql',         true),
    ('ฟังก์ชัน', 'admin_set_must_change',            '07_admin.sql',         true),
    ('ฟังก์ชัน', 'change_my_password',               '09_self_password.sql', true),
    -- ยกเลิก / ลบ ประกาศ  (ถ้าขาด จะยื่นราคาไม่ได้เลย)
    ('คอลัมน์',  'tenders.cancelled_at',             '10_manage_tender.sql', true),
    ('คอลัมน์',  'tenders.cancel_reason',            '10_manage_tender.sql', true),
    ('ฟังก์ชัน', 'cancel_tender',                    '10_manage_tender.sql', true),
    ('ฟังก์ชัน', 'delete_tender',                    '10_manage_tender.sql', true),
    ('ฟังก์ชัน', 'assert_tender_active',             '10_manage_tender.sql', true),
    -- ผูกบัญชีใหม่จากในเว็บ
    ('ฟังก์ชัน', 'admin_pending_accounts',           '11_link_users.sql',    true),
    ('ฟังก์ชัน', 'admin_link_user',                  '11_link_users.sql',    true),
    ('ฟังก์ชัน', 'admin_unlink_user',                '11_link_users.sql',    true),
    -- ซ่อนงบประมาณจากผู้ขาย: ต้องมีในตารางลับ และต้องไม่มีในตารางที่ผู้ขายอ่านได้
    ('คอลัมน์',  'tender_internal.budget',           '12_hide_budget.sql',   true),
    ('คอลัมน์',  'tenders.budget',                   '12_hide_budget.sql',   false)
  ) as v(kind, name, file, want)
) e
order by e.ok, e.file, e.name;

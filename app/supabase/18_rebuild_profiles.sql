-- ============================================================================
-- กู้บัญชีที่ "เด้งออก" ทั้งหมดกลับมา
--
-- อาการ: ทุกคนเข้าระบบแล้วเจอหน้า "บัญชีนี้ยังไม่ได้เปิดใช้งาน"
-- สาเหตุ: แถวในตาราง public.profiles หายไป (บัญชีใน Authentication ยังอยู่ครบ
--         เพราะอยู่คนละที่กัน) — เกิดได้จากการรัน 00_all_in_one.sql ซ้ำ
--         ซึ่งลบตารางทั้งหมดทิ้งก่อนสร้างใหม่
--
-- ไฟล์นี้สร้างแถว profiles กลับมาจากร่องรอยที่ยังเหลืออยู่ในฐานข้อมูล
--   ใครเคยสร้าง/เปิดซอง/ประกาศผล  → ฝ่ายจัดซื้อ
--   ใครเคยยื่นใบเสนอราคา           → ผู้ขาย พร้อมบริษัทที่เคยสังกัด
-- ไม่แตะบัญชีที่ยังผูกอยู่ดี ๆ รันซ้ำได้ ไม่ลบอะไรเลย
--
--   cat ~/Desktop/supplier-bidding/app/supabase/18_rebuild_profiles.sql | pbcopy
-- ============================================================================

-- ---------- 1) ฝ่ายจัดซื้อ: คนที่เคยลงมือทำอะไรกับประกาศ ----------
insert into public.profiles (id, role, full_name, position, supplier_id, must_change_password)
select distinct on (x.uid)
       x.uid, 'buyer',
       initcap(replace(split_part(u.email, '@', 1), '.', ' ')),
       'ฝ่ายจัดซื้อกลาง', null, false
from (
  select created_by  as uid from public.tenders where created_by  is not null
  union select unsealed_by   from public.tenders where unsealed_by is not null
  union select awarded_by    from public.tenders where awarded_by  is not null
  union select uploaded_by   from public.tender_files where uploaded_by is not null
) x
join auth.users u on u.id = x.uid
where not exists (select 1 from public.profiles p where p.id = x.uid)
on conflict (id) do nothing;

-- ---------- 2) ผู้ขาย: คนที่เคยยื่นราคา (ได้บริษัทที่สังกัดมาด้วย) ----------
insert into public.profiles (id, role, full_name, position, supplier_id, must_change_password)
select distinct on (b.created_by)
       b.created_by, 'supplier',
       initcap(replace(split_part(u.email, '@', 1), '.', ' ')),
       'ผู้ติดต่อ', b.supplier_id, false
from public.bids b
join auth.users u on u.id = b.created_by
where b.created_by is not null
  and not exists (select 1 from public.profiles p where p.id = b.created_by)
order by b.created_by, b.submitted_at desc
on conflict (id) do nothing;

-- ---------- 3) รายงาน: ใครกลับมาแล้ว ใครยังต้องผูกมือ ----------
-- แถวที่ขึ้น "ยังไม่ได้ผูก" ให้ไปผูกที่หน้าเว็บ เมนู "ผู้ใช้และผู้ขาย"
-- (ชื่อที่กู้มาเดาจากอีเมล แก้ให้ถูกได้ภายหลังที่หน้าเดียวกัน)
select
  u.email                                         as "อีเมล",
  coalesce(p.role, '— ยังไม่ได้ผูก —')             as "บทบาท",
  coalesce(s.name, case when p.role = 'buyer'
                        then 'ฝ่ายจัดซื้อกลาง' else '—' end)  as "สังกัด",
  p.full_name                                     as "ชื่อที่กู้มา",
  to_char(u.created_at, 'DD Mon YY')               as "สร้างบัญชีเมื่อ"
from auth.users u
left join public.profiles p  on p.id = u.id
left join public.suppliers s on s.id = p.supplier_id
order by (p.role is null) desc, p.role, u.email;

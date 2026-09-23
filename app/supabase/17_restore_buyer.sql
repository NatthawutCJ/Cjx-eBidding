-- ============================================================================
-- คืนสิทธิ "ฝ่ายจัดซื้อ" ให้บัญชีที่หลุดไป + บอกว่าหลุดเพราะอะไร
--
-- ใช้เมื่อบัญชีฝ่ายจัดซื้อเข้าระบบแล้วเจอหน้า "บัญชีนี้ยังไม่ได้เปิดใช้งาน"
-- หรือกลายเป็นซัพพลายเออร์ไปเฉย ๆ
--
-- ปลอดภัย: แตะเฉพาะบัญชีที่ระบุอีเมลไว้เท่านั้น ไม่ยุ่งกับข้อมูลประมูล รันซ้ำได้
--   cat ~/Desktop/supplier-bidding/app/supabase/17_restore_buyer.sql | pbcopy
-- ============================================================================

do $restore$
declare
  v_email text := 'natthawut.yut@cjmart.co.th';   -- <<< แก้อีเมลตรงนี้ถ้าจะใช้กับบัญชีอื่น
  v_name  text := 'Natthawut';
  v_id    uuid;
  v_role  text;
  v_sup   uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(v_email);
  if v_id is null then
    raise exception 'ไม่พบอีเมล % ใน Authentication > Users', v_email;
  end if;

  select p.role, p.supplier_id into v_role, v_sup from public.profiles p where p.id = v_id;

  if v_role is null then
    raise notice 'ก่อนแก้: ไม่มีแถวใน profiles เลย (บัญชีหลุดออกจากระบบทั้งใบ)';
  else
    raise notice 'ก่อนแก้: role = % / supplier_id = %', v_role, coalesce(v_sup::text, 'null');
  end if;

  insert into public.profiles (id, role, full_name, position, supplier_id, must_change_password)
  values (v_id, 'buyer', v_name, 'ฝ่ายจัดซื้อกลาง', null, false)
  on conflict (id) do update
    set role = 'buyer',
        supplier_id = null,                        -- ฝ่ายจัดซื้อต้องไม่สังกัดบริษัทผู้ขาย
        full_name = coalesce(nullif(btrim(public.profiles.full_name), ''), v_name),
        position  = coalesce(nullif(btrim(public.profiles.position), ''), 'ฝ่ายจัดซื้อกลาง');

  raise notice 'หลังแก้: role = buyer เรียบร้อย';
end $restore$;

-- ============================================================================
-- กันไม่ให้เกิดซ้ำ: ผูกบัญชีที่เป็นฝ่ายจัดซื้ออยู่ให้กลายเป็นผู้ขายไม่ได้อีก
-- (เวอร์ชันเดียวกับใน 11_link_users.sql — รันไฟล์นี้แล้วไม่ต้องรัน 11 ซ้ำ)
-- ============================================================================

-- ---------- ผูกบัญชีกับบริษัท ----------
-- ใช้ได้ทั้งกับบัญชีใหม่ (ยังไม่มี profile) และแก้บริษัทของบัญชีเดิม
create or replace function public.admin_link_user(
  p_email       text,
  p_full_name   text,
  p_role        text default 'supplier',
  p_supplier_id uuid default null,
  p_position    text default 'ผู้ติดต่อ'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  if p_role not in ('buyer','supplier') then raise exception 'บทบาทต้องเป็น buyer หรือ supplier'; end if;
  if p_role = 'supplier' and p_supplier_id is null then
    raise exception 'บัญชีผู้ขายต้องเลือกบริษัท';
  end if;
  if p_role = 'buyer' and p_supplier_id is not null then
    raise exception 'บัญชีฝ่ายจัดซื้อต้องไม่สังกัดบริษัทผู้ขาย';
  end if;

  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'ไม่พบอีเมล % ใน Authentication > Users — สร้างบัญชีก่อน (ติ๊ก Auto Confirm) แล้วกดผูกอีกครั้ง', p_email;
  end if;

  -- กันบัญชีฝ่ายจัดซื้อถูกลดชั้นเป็นผู้ขายโดยไม่ตั้งใจ (เคยเกิดจริง: จัดซื้อหลุดสิทธิ์ทั้งใบ)
  -- ถ้าตั้งใจเปลี่ยนจริง ให้ถอนการผูกก่อนแล้วค่อยผูกใหม่ จะได้มีร่องรอยสองบรรทัดใน admin_actions
  if p_role <> 'buyer'
     and exists (select 1 from public.profiles where id = v_id and role = 'buyer') then
    raise exception 'บัญชี % เป็นฝ่ายจัดซื้ออยู่ เปลี่ยนเป็นผู้ขายตรง ๆ ไม่ได้ — ถอนการผูกก่อนถ้าตั้งใจเปลี่ยนจริง', p_email;
  end if;
  if v_id = auth.uid() and p_role <> 'buyer' then
    raise exception 'เปลี่ยนบทบาทของบัญชีตัวเองไม่ได้';
  end if;

  insert into public.profiles (id, role, full_name, position, supplier_id, must_change_password)
  values (v_id, p_role, coalesce(nullif(trim(p_full_name),''), split_part(p_email,'@',1)),
          p_position, p_supplier_id, true)
  on conflict (id) do update
     set role = excluded.role,
         full_name = excluded.full_name,
         position = excluded.position,
         supplier_id = excluded.supplier_id;

  insert into public.admin_actions (actor_id, target_id, action, note)
  values (auth.uid(), v_id, 'link_user',
          'ผูก ' || p_email || ' เป็น ' || p_role ||
          coalesce(' / ' || (select name from public.suppliers where id = p_supplier_id), ''));

  return v_id;
end $$;

-- ---------- ผลลัพธ์ + ร่องรอยว่าใครทำอะไรกับบัญชีนี้ ----------
select
  u.email                                                   as "อีเมล",
  p.role                                                    as "บทบาทตอนนี้",
  coalesce(s.name, '— ไม่สังกัดบริษัทผู้ขาย —')              as "สังกัด",
  p.must_change_password                                    as "ต้องเปลี่ยนรหัส",
  coalesce((
    select string_agg(a.action || ' เมื่อ ' || to_char(a.created_at, 'DD Mon YY HH24:MI'),
                      '  ·  ' order by a.created_at desc)
    from public.admin_actions a
    where a.target_id = p.id
  ), 'ไม่มีประวัติการแก้บัญชีนี้ผ่านหน้าเว็บ')                as "ประวัติการแก้บัญชีนี้"
from public.profiles p
join auth.users u on u.id = p.id
left join public.suppliers s on s.id = p.supplier_id
where lower(u.email) = lower('natthawut.yut@cjmart.co.th');



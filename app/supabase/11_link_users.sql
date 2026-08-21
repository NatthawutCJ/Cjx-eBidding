-- ============================================================================
-- เพิ่มผู้ขายรายใหม่ได้จากในเว็บ (ไม่ต้องแตะ SQL ทุกครั้ง)
--
-- ปัญหาเดิม: สร้าง user ใน Authentication แล้วล็อกอินไม่ได้ ขึ้นว่า
--            "Cannot coerce the result to a single JSON object"
--            เพราะบัญชีนั้นยังไม่มีแถวใน public.profiles ระบบจึงไม่รู้ว่าเป็นใคร บริษัทไหน
--
-- ไฟล์นี้เพิ่ม 3 ฟังก์ชันให้ฝ่ายจัดซื้อทำจากหน้า "ผู้ใช้และผู้ขาย" ได้เอง
--   admin_pending_accounts()  ดูบัญชีที่สร้างแล้วแต่ยังไม่ได้ผูกบริษัท
--   admin_link_user()         ผูกบัญชีกับบริษัท + กำหนดบทบาท
--   admin_unlink_user()       ถอนการผูก (บัญชีจะเข้าใช้งานไม่ได้จนผูกใหม่)
--
--   cat ~/Desktop/supplier-bidding/app/supabase/11_link_users.sql | pbcopy
-- ============================================================================

-- ---------- บัญชีที่ยังไม่ได้ผูก ----------
create or replace function public.admin_pending_accounts()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
    order by u.created_at desc;
end $$;

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

-- ---------- ถอนการผูก ----------
create or replace function public.admin_unlink_user(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_bids int; v_role text;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  if p_target = auth.uid() then raise exception 'ถอนการผูกบัญชีของตัวเองไม่ได้'; end if;

  select role into v_role from public.profiles where id = p_target;
  if v_role is null then raise exception 'บัญชีนี้ยังไม่ได้ผูก'; end if;

  select count(*) into v_bids from public.bids where created_by = p_target;
  if v_bids > 0 then
    raise exception 'บัญชีนี้เคยยื่นราคาไว้ % ใบ จึงถอนการผูกไม่ได้ (จะทำให้ประวัติขาด) — ถ้าต้องการปิดการใช้งานให้เปลี่ยนรหัสผ่านแทน', v_bids;
  end if;

  insert into public.admin_actions (actor_id, target_id, action, note)
  values (auth.uid(), p_target, 'unlink_user', 'ถอนการผูกบัญชี');

  delete from public.profiles where id = p_target;
end $$;

grant execute on function
  public.admin_pending_accounts, public.admin_link_user, public.admin_unlink_user
to authenticated;

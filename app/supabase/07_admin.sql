-- ============================================================================
-- หน้าจัดการผู้ใช้สำหรับฝ่ายจัดซื้อ — ตั้งรหัสผ่านใหม่ให้ผู้ขายได้จากในเว็บ
-- ไม่ต้องแก้ SQL ไม่ต้องพึ่งอีเมล และไม่ต้องใช้ service key ที่ frontend
--
-- รันไฟล์นี้ครั้งเดียวหลังติดตั้ง 00_all_in_one.sql
--   cat ~/Desktop/supplier-bidding/app/supabase/07_admin.sql | pbcopy
-- ============================================================================

-- ---------- บันทึกการใช้อำนาจของผู้ดูแล (ตรวจย้อนหลังได้) ----------
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  target_id   uuid references public.profiles(id),
  action      text not null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read on public.admin_actions
  for select using (public.is_buyer());

revoke insert, update, delete on public.admin_actions from anon, authenticated;

-- ---------- รายชื่อผู้ใช้ (ฝ่ายจัดซื้อเท่านั้น) ----------
-- profiles ไม่มีอีเมล เพราะอีเมลอยู่ใน auth.users ที่ client อ่านตรงไม่ได้
-- ฟังก์ชันนี้เป็น security definer จึงอ่านมาให้ได้ แต่เปิดให้เฉพาะฝ่ายจัดซื้อ
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, role text, full_name text, org text,
  must_change_password boolean, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  return query
    select p.id, u.email::text, p.role, p.full_name,
           coalesce(s.name, 'ฝ่ายจัดซื้อกลาง') as org,
           p.must_change_password, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.suppliers s on s.id = p.supplier_id
    order by p.role desc, s.name nulls first;
end $$;

-- ---------- ตั้งรหัสผ่านใหม่ให้ผู้ขาย ----------
-- เขียนรหัสแบบ bcrypt ลง auth.users เหมือนที่ Supabase ทำเอง
-- ข้อจำกัดที่ตั้งใจใส่: ตั้งได้เฉพาะบัญชี role = 'supplier'
--   บัญชีฝ่ายจัดซื้อตั้งรหัสให้กันเองไม่ได้ ลดความเสียหายถ้าบัญชีผู้ดูแลถูกยึด
create or replace function public.admin_set_supplier_password(p_target uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_email text;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'; end if;

  select p.role, u.email into v_role, v_email
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_target;

  if v_role is null then raise exception 'ไม่พบผู้ใช้รายนี้'; end if;
  if v_role <> 'supplier' then
    raise exception 'ตั้งรหัสผ่านได้เฉพาะบัญชีผู้ขาย — บัญชีฝ่ายจัดซื้อให้ใช้ไฟล์ 06_reset_password.sql';
  end if;

  begin
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')),
                                   updated_at = now(),
                                   email_confirmed_at = coalesce(email_confirmed_at, now())
             where id = $2' using p_password, p_target;
  exception when undefined_function or invalid_schema_name then
    execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')),
                                   updated_at = now(),
                                   email_confirmed_at = coalesce(email_confirmed_at, now())
             where id = $2' using p_password, p_target;
  end;

  -- บังคับให้เจ้าของบัญชีเปลี่ยนรหัสเองตอนเข้าครั้งถัดไป
  update public.profiles set must_change_password = true where id = p_target;

  insert into public.admin_actions (actor_id, target_id, action, note)
  values (auth.uid(), p_target, 'set_password', 'ตั้งรหัสชั่วคราวให้ ' || v_email);
end $$;

-- ---------- บังคับ / ยกเลิกการบังคับเปลี่ยนรหัส ----------
create or replace function public.admin_set_must_change(p_target uuid, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  update public.profiles set must_change_password = p_value where id = p_target;
  insert into public.admin_actions (actor_id, target_id, action, note)
  values (auth.uid(), p_target, 'must_change_password',
          case when p_value then 'บังคับให้เปลี่ยนรหัสครั้งถัดไป' else 'ยกเลิกการบังคับเปลี่ยนรหัส' end);
end $$;

grant execute on function
  public.admin_list_users, public.admin_set_supplier_password, public.admin_set_must_change
to authenticated;

-- ============================================================================
-- ตั้งรหัสผ่านใหม่ให้ผู้ใช้โดยตรงจาก SQL — ใช้ตอนอีเมลของ Supabase ใช้ไม่ได้
-- (ปุ่ม "ลืมรหัสผ่าน" ขึ้น HTTP 504 เพราะบริการอีเมลในตัวของ free tier ไม่ตอบ)
--
-- วิธีใช้: แก้ 2 บรรทัดที่มี << แก้  แล้ววางไฟล์นี้ใน SQL Editor กด Run
--   cat ~/Desktop/supplier-bidding/app/supabase/06_reset_password.sql | pbcopy
-- ============================================================================

do $$
declare
  v_email text := 'natthawut.yut@cjmart.co.th';  -- << แก้ อีเมลของคนที่จะตั้งรหัสใหม่
  v_pass  text := 'CJx-Start-2026';              -- << แก้ รหัสชั่วคราว (ยาว 8 ตัวขึ้นไป มีตัวอักษรและตัวเลข)
  v_force boolean := true;                       -- true = ให้เขาถูกบังคับเปลี่ยนรหัสตอนเข้าครั้งแรก
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'ไม่พบผู้ใช้อีเมล % ใน Authentication > Users', v_email;
  end if;

  -- pgcrypto อยู่ในสคีมา extensions บน Supabase แต่บางโปรเจกต์อยู่ใน public
  -- จึงลองทางแรกก่อน ถ้าไม่มีให้ใช้ทางที่สอง
  begin
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')),
                                   updated_at = now(),
                                   email_confirmed_at = coalesce(email_confirmed_at, now())
             where id = $2'
      using v_pass, v_id;
  exception when undefined_function or invalid_schema_name then
    execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')),
                                   updated_at = now(),
                                   email_confirmed_at = coalesce(email_confirmed_at, now())
             where id = $2'
      using v_pass, v_id;
  end;

  update public.profiles set must_change_password = v_force where id = v_id;

  raise notice 'ตั้งรหัสใหม่ให้ % เรียบร้อย — เข้าสู่ระบบด้วยรหัส: %', v_email, v_pass;
end $$;

-- ============================================================================
-- ตัวช่วยอื่น — เอา -- ข้างหน้าออกเฉพาะบรรทัดที่ต้องการใช้
-- ============================================================================

-- (1) ตั้งรหัสเดียวกันให้ทุกคนพร้อมกัน (สะดวกช่วงติดตั้ง/ทดสอบ)
-- do $$
-- declare v_pass text := 'CJx-Start-2026'; r record;
-- begin
--   for r in select id, email from auth.users loop
--     begin
--       execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where id = $2' using v_pass, r.id;
--     exception when undefined_function or invalid_schema_name then
--       execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')), updated_at = now() where id = $2' using v_pass, r.id;
--     end;
--     raise notice 'ตั้งรหัสใหม่: %', r.email;
--   end loop;
-- end $$;

-- (2) ปลดเงื่อนไข "ต้องเปลี่ยนรหัสก่อนใช้งาน" ให้ทุกคน (ใช้ตอนอยากทดสอบระบบก่อน)
-- update public.profiles set must_change_password = false;

-- (3) บังคับให้คนใดคนหนึ่งเปลี่ยนรหัสใหม่อีกครั้ง
-- update public.profiles set must_change_password = true
--  where id = (select id from auth.users where email = 'saksit.sai@cjmart.co.th');

-- (4) ดูสถานะผู้ใช้ทั้งหมด
select u.email,
       p.role,
       coalesce(s.name,'ฝ่ายจัดซื้อกลาง') as org,
       p.must_change_password as "ต้องเปลี่ยนรหัส",
       u.updated_at as "แก้ไขล่าสุด"
from auth.users u
left join public.profiles p on p.id = u.id
left join public.suppliers s on s.id = p.supplier_id
order by p.role desc nulls last, u.email;

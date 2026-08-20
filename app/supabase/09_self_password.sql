-- ============================================================================
-- เปลี่ยนรหัสผ่านด้วยตัวเอง โดยไม่ผ่าน Supabase Auth API
--
-- ทำไมต้องมีไฟล์นี้:
--   คำสั่ง supabase.auth.updateUser({password}) ของโปรเจกต์นี้ค้างไม่ตอบกลับ
--   (สาเหตุที่พบบ่อยคือ GoTrue พยายามส่งอีเมลแจ้ง หรือเรียกบริการตรวจรหัสที่หลุดจากภายนอก
--    แล้วรอจนหมดเวลา — โปรเจกต์ที่ยังไม่ได้ต่อ SMTP จะเจออาการนี้)
--   ฟังก์ชันนี้ทำงานในฐานข้อมูลตรงๆ ตรวจรหัสเดิมและเขียนรหัสใหม่แบบ bcrypt
--   จึงไม่ต้องพึ่งอีเมลและไม่มีอะไรค้าง
--
--   cat ~/Desktop/supplier-bidding/app/supabase/09_self_password.sql | pbcopy
-- ============================================================================

create or replace function public.change_my_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := auth.uid();
  v_hash text;
  v_ok boolean := false;
begin
  if v_id is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if length(coalesce(p_new,'')) < 8 then
    raise exception 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร';
  end if;
  if p_new = p_current then
    raise exception 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม';
  end if;

  select encrypted_password into v_hash from auth.users where id = v_id;
  if v_hash is null then raise exception 'ไม่พบบัญชีผู้ใช้'; end if;

  -- ตรวจรหัสเดิม: เข้ารหัสรหัสที่กรอกด้วย salt เดิม ถ้าได้ค่าเท่ากันคือถูกต้อง
  begin
    v_ok := (extensions.crypt(p_current, v_hash) = v_hash);
  exception when undefined_function or invalid_schema_name then
    v_ok := (crypt(p_current, v_hash) = v_hash);
  end;
  if not v_ok then raise exception 'รหัสผ่านเดิมไม่ถูกต้อง'; end if;

  -- เขียนรหัสใหม่
  begin
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')),
                                   updated_at = now() where id = $2'
      using p_new, v_id;
  exception when undefined_function or invalid_schema_name then
    execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')),
                                   updated_at = now() where id = $2'
      using p_new, v_id;
  end;

  update public.profiles
     set must_change_password = false, password_changed_at = now()
   where id = v_id;
end $$;

grant execute on function public.change_my_password to authenticated;

-- หมายเหตุ: วิธีนี้ไม่ยกเลิก session ที่ล็อกอินอยู่ที่อื่น (ต่างจาก updateUser ของ Supabase)
-- ถ้าต้องการบังคับให้ทุกเครื่องออกจากระบบหลังเปลี่ยนรหัส ให้ลบ refresh token ของผู้ใช้คนนั้นเพิ่ม:
--   delete from auth.refresh_tokens where user_id = 'UUID';

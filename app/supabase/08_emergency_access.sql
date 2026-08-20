-- ============================================================================
-- กู้คืนการเข้าระบบ — ใช้ตอนล็อกอินไม่ได้ทุกบัญชี
-- ตั้งรหัสเดียวกันให้ทุกคน + ปลดทุกเงื่อนไขที่ขัดการเข้าระบบ
--
-- วางไฟล์นี้ใน SQL Editor แล้วกด Run ได้เลย (แก้ v_pass ถ้าต้องการรหัสอื่น)
--   cat ~/Desktop/supplier-bidding/app/supabase/08_emergency_access.sql | pbcopy
-- ============================================================================

do $$
declare
  v_pass  text    := 'CJx-Start-2026';  -- << รหัสชั่วคราวที่จะใช้กับทุกบัญชี
  v_force boolean := true;              -- << true = บังคับให้ทุกคนตั้งรหัสของตัวเองตอนเข้าครั้งถัดไป
                                        --    ตั้ง false เฉพาะกรณีที่กำลังติดอยู่และอยากเข้าไปใช้งานก่อน
  v_only_suppliers boolean := false;    -- << true = บังคับเฉพาะบัญชีผู้ขาย (บัญชีจัดซื้อไม่ต้องเปลี่ยน)
  r record;
  n int := 0;
begin
  for r in select id, email from auth.users loop
    -- เขียนรหัสแบบ bcrypt ลงตรงๆ (ข้ามระบบอีเมลของ Supabase ที่ตอบ 504)
    begin
      execute 'update auth.users set
                 encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')),
                 email_confirmed_at = coalesce(email_confirmed_at, now()),
                 confirmation_token = '''',
                 recovery_token = '''',
                 banned_until = null,
                 updated_at = now()
               where id = $2'
        using v_pass, r.id;
    exception when undefined_function or invalid_schema_name then
      execute 'update auth.users set
                 encrypted_password = crypt($1, gen_salt(''bf'')),
                 email_confirmed_at = coalesce(email_confirmed_at, now()),
                 confirmation_token = '''',
                 recovery_token = '''',
                 banned_until = null,
                 updated_at = now()
               where id = $2'
        using v_pass, r.id;
    end;
    n := n + 1;
    raise notice 'ตั้งรหัสใหม่: %', r.email;
  end loop;

  -- รหัสนี้เป็นรหัสที่ผู้ดูแลรู้ จึงควรบังคับให้เจ้าของบัญชีตั้งรหัสของตัวเองทันทีที่เข้ามา
  if v_only_suppliers then
    update public.profiles set must_change_password = v_force where role = 'supplier';
    update public.profiles set must_change_password = false   where role = 'buyer';
  else
    update public.profiles set must_change_password = v_force;
  end if;

  raise notice 'เสร็จ % บัญชี — เข้าสู่ระบบด้วยรหัส: % (บังคับเปลี่ยนรหัส: %)', n, v_pass, v_force;
end $$;

-- ตรวจผล: ทุกแถวต้องมี email ยืนยันแล้ว และไม่ถูกแบน
select u.email,
       p.role,
       coalesce(s.name,'ฝ่ายจัดซื้อกลาง') as org,
       (u.email_confirmed_at is not null) as "ยืนยันอีเมลแล้ว",
       (u.banned_until is null)           as "ไม่ถูกแบน",
       p.must_change_password             as "ต้องเปลี่ยนรหัส",
       u.updated_at                       as "แก้ไขล่าสุด"
from auth.users u
left join public.profiles p on p.id = u.id
left join public.suppliers s on s.id = p.supplier_id
order by p.role desc nulls last, u.email;

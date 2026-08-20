-- ============================================================================
-- ข้อมูลตัวอย่าง — รันหลังสร้างผู้ใช้ใน Authentication > Users แล้ว
--
-- ไฟล์นี้ค้นหาผู้ใช้จาก "อีเมล" ไม่ต้องคัดลอก UUID มาวางแล้ว
-- แก้แค่ 4 บรรทัดที่มีเครื่องหมาย  << แก้  ให้ตรงกับอีเมลที่สร้างไว้
--
-- วิธีคัดลอกไฟล์นี้แบบไม่ตกหล่น (แนะนำ):
--   cat ~/Desktop/supplier-bidding/app/supabase/05_seed.sql | pbcopy
-- แล้วไปวางใน SQL Editor · กดที่พื้นที่ว่างก่อนกด Run เพื่อไม่ให้มีข้อความถูกเลือกค้าง
-- ============================================================================

-- ---------- บริษัทผู้ขาย ----------
insert into public.suppliers (code, name, tax_id) values
  ('V-1001','Buum Company',   null),
  ('V-1002','Amm Company',    null),
  ('V-1003','Sanddy Company', null)
on conflict (code) do nothing;
-- เลขผู้เสียภาษีเติมภายหลังได้ที่ Table Editor > suppliers

-- ---------- ผูกผู้ใช้กับบทบาทและบริษัท ----------
do $$
declare
  em_buyer text := 'natthawut.yut@cjmart.co.th';   -- ฝ่ายจัดซื้อกลาง
  em_sup1  text := 'chatnapa.ton@cjmart.co.th';    -- Buum Company   (V-1001)
  em_sup2  text := 'passara.rat@cjmart.co.th';     -- Amm Company    (V-1002)
  em_sup3  text := 'saksit.sai@cjmart.co.th';      -- Sanddy Company (V-1003)

  u_buyer uuid; u1 uuid; u2 uuid; u3 uuid;
  missing text := '';
begin
  select id into u_buyer from auth.users where lower(email) = lower(em_buyer);
  select id into u1      from auth.users where lower(email) = lower(em_sup1);
  select id into u2      from auth.users where lower(email) = lower(em_sup2);
  select id into u3      from auth.users where lower(email) = lower(em_sup3);

  if u_buyer is null then missing := missing || em_buyer || ', '; end if;
  if u1 is null      then missing := missing || em_sup1  || ', '; end if;
  if u2 is null      then missing := missing || em_sup2  || ', '; end if;
  if u3 is null      then missing := missing || em_sup3  || ', '; end if;

  if missing <> '' then
    raise exception
      'ยังไม่พบผู้ใช้เหล่านี้ใน Authentication > Users: %— ให้สร้างผู้ใช้ (ติ๊ก Auto Confirm) หรือแก้อีเมล 4 บรรทัดบนสุดของไฟล์นี้ให้ตรงกับที่สร้างไว้ แล้วรันใหม่',
      missing;
  end if;

  -- must_change_password ปล่อยเป็นค่าเริ่มต้น true ทุกบัญชี
  -- ทุกคนจะถูกบังคับเปลี่ยนรหัสที่ฝ่ายจัดซื้อตั้งให้ ตอนเข้าใช้งานครั้งแรก
  insert into public.profiles (id, role, full_name, position, supplier_id) values
    (u_buyer,'buyer','Natthawut','ฝ่ายจัดซื้อกลาง', null),
    (u1,'supplier','Chatnapa','ผู้ติดต่อ',
      (select id from public.suppliers where code='V-1001')),
    (u2,'supplier','Passara','ผู้ติดต่อ',
      (select id from public.suppliers where code='V-1002')),
    (u3,'supplier','Saksit','ผู้ติดต่อ',
      (select id from public.suppliers where code='V-1003'))
  on conflict (id) do update
    set role = excluded.role,
        full_name = excluded.full_name,
        position = excluded.position,
        supplier_id = excluded.supplier_id;

  raise notice 'ผูกผู้ใช้เรียบร้อย 4 บัญชี';
end $$;

-- ---------- ประกาศตัวอย่าง 2 งาน (เปิดราคา 1 / ปิดราคา 1) ----------
do $$
declare
  v_buyer uuid := (select id from public.profiles where role='buyer' limit 1);
  v_open  uuid; v_sealed uuid;
begin
  if v_buyer is null then
    raise notice 'ยังไม่มีโปรไฟล์ฝ่ายจัดซื้อ ข้ามการสร้างประกาศตัวอย่าง';
    return;
  end if;
  if exists (select 1 from public.tenders) then
    raise notice 'มีประกาศอยู่แล้ว ข้ามการสร้างข้อมูลตัวอย่าง (กันข้อมูลซ้ำเวลารันไฟล์นี้หลายครั้ง)';
    return;
  end if;

  -- งานเปิดราคา
  insert into public.tenders (code,title,description,type,budget,closes_at,created_by)
  values (public.next_tender_code(),
          'ถุงหูหิ้วพลาสติก HDPE 6 ขนาด (ล็อตตัวอย่าง)',
          'ประมูลแบบเปิด — เห็นราคาคู่แข่งเรียลไทม์ ปรับราคาได้จนหมดเวลา',
          'open', 1850000, now() + interval '2 days', v_buyer)
  returning id into v_open;

  insert into public.tender_internal (tender_id, target_price) values (v_open, 1100000);
  insert into public.tender_items (tender_id,name,spec,qty,unit,sort) values
    (v_open,'ถุงหูหิ้ว HDPE 6x11 นิ้ว','หนา 0.020 มม.',12000,'กก.',0),
    (v_open,'ถุงหูหิ้ว HDPE 9x18 นิ้ว','หนา 0.025 มม.',9000,'กก.',1),
    (v_open,'ถุงหูหิ้ว HDPE 12x20 นิ้ว','หนา 0.030 มม.',6500,'กก.',2);
  insert into public.tender_required_docs (tender_id,label,sort) values
    (v_open,'ใบเสนอราคาลงนาม (PDF)',0),
    (v_open,'หนังสือรับรองบริษัท',1),
    (v_open,'ภ.พ.20 / ทะเบียนภาษี',2);
  insert into public.tender_invites (tender_id, supplier_id)
    select v_open, id from public.suppliers;
  insert into public.tender_events (tender_id, actor_id, kind, message)
    values (v_open, v_buyer, 'publish', 'ประกาศเชิญประมูลใหม่ (ข้อมูลตัวอย่าง)');

  -- งานปิดราคา
  insert into public.tenders (code,title,description,type,budget,closes_at,created_by)
  values (public.next_tender_code(),
          'ข้าวหอมมะลิ 100% ถุง 5 กก. (ล็อตตัวอย่าง)',
          'ประมูลแบบปิดซอง — ปรับราคาได้จนหมดเวลา ไม่มีใครเห็นราคาของกัน เปิดซองพร้อมกันทีเดียว',
          'sealed', 4200000, now() + interval '3 days', v_buyer)
  returning id into v_sealed;

  insert into public.tender_internal (tender_id, target_price) values (v_sealed, 3980000);
  insert into public.tender_items (tender_id,name,spec,qty,unit,sort) values
    (v_sealed,'ข้าวหอมมะลิ 100% ชั้น 1','ถุงสุญญากาศ 5 กก.',24000,'ถุง',0),
    (v_sealed,'ข้าวหอมมะลิผสม 70%','ถุง 5 กก. พิมพ์แบรนด์ร่วม',18000,'ถุง',1);
  insert into public.tender_required_docs (tender_id,label,sort) values
    (v_sealed,'ใบเสนอราคาลงนาม (PDF)',0),
    (v_sealed,'หนังสือรับรองบริษัท',1),
    (v_sealed,'ใบรับรอง GMP/HACCP',2);
  insert into public.tender_invites (tender_id, supplier_id)
    select v_sealed, id from public.suppliers;

  raise notice 'สร้างประกาศตัวอย่าง 2 งานเรียบร้อย';
end $$;

-- ---------- ตรวจผล ----------
select p.role, p.full_name, coalesce(s.name,'ฝ่ายจัดซื้อกลาง') as org,
       p.must_change_password as "ต้องเปลี่ยนรหัสครั้งแรก"
from public.profiles p left join public.suppliers s on s.id = p.supplier_id
order by p.role desc, s.code;

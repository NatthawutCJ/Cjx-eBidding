-- ============================================================================
-- ข้อมูลตัวอย่าง — รันหลังสร้างผู้ใช้ใน Authentication > Users แล้ว
--
-- ขั้นตอน
--   1) Dashboard > Authentication > Users > Add user (ใส่อีเมล + รหัสผ่าน)
--      สร้าง 1 บัญชีสำหรับฝ่ายจัดซื้อ และ 1 บัญชีต่อ 1 ซัพพลายเออร์
--   2) คัดลอก UUID ของแต่ละ user มาแทนใน block ด้านล่าง
--   3) รันไฟล์นี้
-- ============================================================================

-- ---------- บริษัทผู้ขาย ----------
insert into public.suppliers (code, name, tax_id) values
  ('V-1042','บจก. สยามฟู้ดส์ ซัพพลาย','0105551234567'),
  ('V-2318','บจก. เอเชีย แพ็คเกจจิ้ง','0105557654321'),
  ('V-3077','หจก. ทรัพย์รุ่งเรือง เทรดดิ้ง','0103556789012')
on conflict (code) do nothing;

-- ---------- ผู้ใช้ ----------
-- แก้ UUID ทั้ง 4 บรรทัดนี้ให้ตรงกับ user ที่สร้างไว้ในขั้นตอนที่ 1
do $$
declare
  buyer_uid uuid := '00000000-0000-0000-0000-000000000001';  -- << แก้
  sup1_uid  uuid := '00000000-0000-0000-0000-000000000002';  -- << แก้ (V-1042)
  sup2_uid  uuid := '00000000-0000-0000-0000-000000000003';  -- << แก้ (V-2318)
  sup3_uid  uuid := '00000000-0000-0000-0000-000000000004';  -- << แก้ (V-3077)
begin
  insert into public.profiles (id, role, full_name, position, supplier_id) values
    (buyer_uid,'buyer','นฤมล กิตติวัฒน์','Senior Buyer', null),
    (sup1_uid,'supplier','ธนกร วงศ์อนันต์','ผู้จัดการฝ่ายขาย',
      (select id from public.suppliers where code='V-1042')),
    (sup2_uid,'supplier','ปิยะ สุขเจริญ','Key Account',
      (select id from public.suppliers where code='V-2318')),
    (sup3_uid,'supplier','วรินทร ตั้งมั่น','เจ้าของกิจการ',
      (select id from public.suppliers where code='V-3077'))
  on conflict (id) do nothing;
end $$;

-- ---------- ประกาศตัวอย่าง 2 งาน (เปิดราคา 1 / ปิดราคา 1) ----------
do $$
declare
  v_buyer uuid := (select id from public.profiles where role='buyer' limit 1);
  v_open  uuid; v_sealed uuid;
begin
  if v_buyer is null then
    raise notice 'ยังไม่มี profile ของฝ่ายจัดซื้อ ข้ามการสร้างประกาศตัวอย่าง';
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
end $$;

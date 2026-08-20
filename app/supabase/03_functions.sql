-- ============================================================================
-- ฟังก์ชันที่ client เรียกผ่าน supabase.rpc()
-- ทุกอย่างที่ต้องเชื่อถือได้ (ยอดรวม, กติกาปิดซอง, เวลาเปิดซอง) คำนวณและตรวจที่นี่
-- ============================================================================

-- ---------- รหัสผ่าน: บันทึกว่าเปลี่ยนเองแล้ว ----------
-- เรียกหลัง supabase.auth.updateUser({password}) สำเร็จ
create or replace function public.mark_password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  update public.profiles
     set must_change_password = false, password_changed_at = now()
   where id = auth.uid();
end $$;

-- ยังใช้รหัสที่ฝ่ายจัดซื้อตั้งให้อยู่หรือไม่
create or replace function public.must_change_password() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select must_change_password from public.profiles where id = auth.uid()), false)
$$;

-- ---------- เลขที่ประกาศ RFQ_YYYY_MM_NNN (รันเลขต่อเดือน) ----------
create or replace function public.next_tender_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := 'RFQ_' || to_char(now(),'YYYY_MM') || '_';
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(v_prefix));   -- กันเลขชนกันเวลาสร้างพร้อมกัน
  select coalesce(max((regexp_replace(code, '^' || v_prefix, ''))::int), 0) + 1
    into v_n
  from public.tenders
  where code like v_prefix || '%'
    and regexp_replace(code, '^' || v_prefix, '') ~ '^\d+$';
  return v_prefix || lpad(v_n::text, 3, '0');
end $$;

-- ---------- จำนวนใบเสนอราคา (เห็นได้ทุกคน โดยไม่เปิดเผยราคา) ----------
create or replace function public.tender_bid_count(p_tender uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when public.can_see_tender(p_tender)
      then (select count(*)::int from public.bids where tender_id = p_tender)
    else 0
  end
$$;

-- ---------- ใครถือค้อน ----------
-- คืน supplier_id ของรายที่เสนอต่ำสุดและถึงราคาคาดหวัง (มีคนกดต่ำกว่า = ย้ายเองโดยธรรมชาติ)
-- ไม่คืนตัวเลขราคาคาดหวังออกไป ผู้ขายจึงรู้แค่ว่า "ถึงเกณฑ์แล้ว" แต่ไม่รู้ว่าเกณฑ์เท่าไร
-- งานปิดราคาที่ยังไม่เปิดซอง คืน null ทุกกรณี (ยังไม่ควรรู้อะไรเลย)
create or replace function public.hammer_holder(p_tender uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_target numeric; v_supplier uuid; v_total numeric;
begin
  if not public.can_see_tender(p_tender) then return null; end if;
  if not public.can_see_prices(p_tender) then return null; end if;

  select target_price into v_target from public.tender_internal where tender_id = p_tender;
  if v_target is null then return null; end if;

  select supplier_id, total into v_supplier, v_total
  from public.bids where tender_id = p_tender
  order by total asc, submitted_at asc limit 1;

  if v_supplier is null or v_total > v_target then return null; end if;
  return v_supplier;
end $$;

-- ---------- ใบของฉันถึงราคาคาดหวังหรือยัง ----------
-- คืน true/false/null เท่านั้น ผู้ขายจึงรู้ว่าต้องกดราคาลงอีกไหม โดยไม่รู้ว่าเกณฑ์เท่าไร
-- ใช้กับงานปิดราคาระหว่างประมูล (ยังไม่เปิดซอง) ซึ่ง hammer_holder() คืน null เสมอ
create or replace function public.my_target_status(p_tender uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_target numeric; v_total numeric;
begin
  if public.my_supplier_id() is null then return null; end if;
  if not public.is_invited(p_tender) then return null; end if;

  select target_price into v_target from public.tender_internal where tender_id = p_tender;
  if v_target is null then return null; end if;

  select total into v_total from public.bids
   where tender_id = p_tender and supplier_id = public.my_supplier_id();
  if v_total is null then return null; end if;

  return v_total <= v_target;
end $$;

-- ---------- สถานะค้อนในมุมผู้ขาย ----------
-- คืน 'mine' | 'other' | 'none' | null เท่านั้น
-- ใช้ในงานปิดราคาระหว่างประมูล: ผู้ขายรู้ว่าค้อนหลุดมือแล้ว (มีคนเสนอต่ำกว่าและถึงเกณฑ์)
-- แต่ไม่ได้ราคา ไม่ได้ชื่อ และไม่ได้ตัวเลขเป้าออกไปด้วย
create or replace function public.my_hammer_state(p_tender uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_target numeric; v_holder uuid; v_total numeric; v_me uuid := public.my_supplier_id();
begin
  if v_me is null then return null; end if;
  if not public.is_invited(p_tender) then return null; end if;

  select target_price into v_target from public.tender_internal where tender_id = p_tender;
  if v_target is null then return null; end if;

  select supplier_id, total into v_holder, v_total
  from public.bids where tender_id = p_tender
  order by total asc, submitted_at asc limit 1;

  if v_holder is null or v_total > v_target then return 'none'; end if;
  return case when v_holder = v_me then 'mine' else 'other' end;
end $$;

-- ---------- ยื่น / ปรับราคา ----------
create or replace function public.submit_bid(
  p_tender uuid,
  p_lines  jsonb,      -- [{"item_id":"uuid","unit_price":41.50}, ...]
  p_note   text default null,
  p_files  jsonb default '[]'::jsonb  -- [{"file_name":"q.pdf","file_path":"...","size_bytes":1234}]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_t public.tenders;
  v_supplier uuid := public.my_supplier_id();
  v_bid public.bids;
  v_total numeric := 0;
  v_missing int;
  v_is_new boolean;
begin
  if v_supplier is null then
    raise exception 'บัญชีนี้ไม่ใช่ผู้ขาย จึงยื่นราคาไม่ได้';
  end if;
  if public.must_change_password() then
    raise exception 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน เพื่อไม่ให้ผู้อื่นยื่นราคาในนามบริษัทของท่านได้';
  end if;

  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;
  if not public.is_invited(p_tender) then
    raise exception 'บริษัทของท่านไม่ได้รับเชิญในงานนี้';
  end if;
  if now() < v_t.opens_at then raise exception 'ยังไม่ถึงเวลาเปิดรับราคา'; end if;
  if now() > v_t.closes_at then raise exception 'ปิดรับราคาแล้ว (%)', to_char(v_t.closes_at,'DD Mon YY HH24:MI'); end if;
  if v_t.awarded_bid_id is not null then raise exception 'ประกาศผลผู้ชนะแล้ว'; end if;

  select * into v_bid from public.bids where tender_id = p_tender and supplier_id = v_supplier;
  v_is_new := v_bid.id is null;

  -- ทุกรายการต้องมีราคา
  select count(*) into v_missing
  from public.tender_items i
  where i.tender_id = p_tender
    and not exists (
      select 1 from jsonb_array_elements(p_lines) l
      where (l->>'item_id')::uuid = i.id and (l->>'unit_price')::numeric > 0
    );
  if v_missing > 0 then raise exception 'ยังกรอกราคาไม่ครบ เหลือ % รายการ', v_missing; end if;

  -- ไม่บังคับเอกสารตอนหยอดราคา ทั้งงานปิดและเปิด — ส่งผ่าน attach_bid_files()
  -- ภายใน 3 วันหลังปิดรับราคา (ดู DOCS_GRACE_DAYS ฝั่ง frontend)

  -- ยอดรวมคำนวณจาก qty ในฐานข้อมูล ไม่รับยอดจาก client
  select sum(i.qty * (l->>'unit_price')::numeric) into v_total
  from public.tender_items i
  join jsonb_array_elements(p_lines) l on (l->>'item_id')::uuid = i.id
  where i.tender_id = p_tender;

  if v_is_new then
    insert into public.bids (tender_id, supplier_id, total, note, created_by)
    values (p_tender, v_supplier, v_total, p_note, auth.uid())
    returning * into v_bid;
  else
    update public.bids
       set total = v_total, note = p_note, version = version + 1, submitted_at = now()
     where id = v_bid.id
    returning * into v_bid;
    delete from public.bid_lines where bid_id = v_bid.id;
    -- ลบไฟล์เดิมเฉพาะเมื่อส่งชุดใหม่มาแทน (หยอดราคาเปล่าๆ จะไม่ล้างเอกสารที่แนบไว้)
    if jsonb_array_length(coalesce(p_files,'[]'::jsonb)) > 0 then
      delete from public.bid_files where bid_id = v_bid.id;
    end if;
  end if;

  insert into public.bid_lines (bid_id, item_id, unit_price)
  select v_bid.id, (l->>'item_id')::uuid, (l->>'unit_price')::numeric
  from jsonb_array_elements(p_lines) l;

  insert into public.bid_files (bid_id, file_name, file_path, size_bytes)
  select v_bid.id, f->>'file_name', f->>'file_path', nullif(f->>'size_bytes','')::bigint
  from jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) f;

  -- งานปิดราคา: ข้อความห้ามมีตัวเลข และซ่อนจากผู้ขายรายอื่น
  insert into public.tender_events (tender_id, actor_id, kind, message, buyer_only)
  select p_tender, auth.uid(),
         case when v_is_new then 'bid' else 'rebid' end,
         case when v_t.type = 'open'
              then s.name || (case when v_is_new then ' ยื่นราคา ' else ' ปรับราคาเป็น ' end)
                   || '฿' || to_char(v_total,'FM999,999,999')
              else s.name || (case when v_is_new then ' ยื่นใบเสนอราคา' else ' ปรับราคาใหม่' end)
                   || ' (ราคาปิดผนึกไว้จนเปิดซอง)'
         end,
         (v_t.type = 'sealed')
  from public.suppliers s where s.id = v_supplier;

  return v_bid.id;
end $$;

-- ---------- เปิดซอง (งานปิดราคา) ----------
create or replace function public.unseal_tender(p_tender uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tenders; v_n int;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;
  if v_t.type <> 'sealed' then raise exception 'งานนี้เป็นแบบเปิดราคา ไม่ต้องเปิดซอง'; end if;
  if v_t.unsealed_at is not null then raise exception 'เปิดซองไปแล้วเมื่อ %', v_t.unsealed_at; end if;
  if now() <= v_t.closes_at then
    raise exception 'เปิดซองได้หลังเวลาปิดรับเท่านั้น (ปิดรับ %)', to_char(v_t.closes_at,'DD Mon YY HH24:MI');
  end if;

  update public.tenders set unsealed_at = now(), unsealed_by = auth.uid() where id = p_tender;
  select count(*) into v_n from public.bids where tender_id = p_tender;

  insert into public.tender_events (tender_id, actor_id, kind, message)
  select p_tender, auth.uid(), 'unseal',
         p.full_name || ' เปิดซองราคา ' || v_t.code || ' — ' || v_n || ' ราย'
  from public.profiles p where p.id = auth.uid();
end $$;

-- ---------- ประกาศผู้ชนะ ----------
create or replace function public.award_bid(p_bid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bids; v_t public.tenders;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  select * into v_b from public.bids where id = p_bid;
  if v_b.id is null then raise exception 'ไม่พบใบเสนอราคานี้'; end if;
  select * into v_t from public.tenders where id = v_b.tender_id;
  if v_t.awarded_bid_id is not null then raise exception 'ประกาศผู้ชนะไปแล้ว'; end if;
  if not public.can_see_prices(v_t.id) then
    raise exception 'ต้องเปิดซองก่อนจึงจะประกาศผู้ชนะได้';
  end if;

  update public.tenders
     set awarded_bid_id = p_bid, awarded_at = now(), awarded_by = auth.uid(),
         closes_at = least(closes_at, now())
   where id = v_t.id;

  insert into public.tender_events (tender_id, actor_id, kind, message)
  select v_t.id, auth.uid(), 'award',
         'ประกาศผู้ชนะ ' || v_t.code || ': ' || s.name || ' ที่ ฿' || to_char(v_b.total,'FM999,999,999')
  from public.suppliers s where s.id = v_b.supplier_id;
end $$;

-- ---------- สร้างประกาศ (ทำในทีเดียวเพื่อให้ atomic) ----------
create or replace function public.create_tender(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  if public.must_change_password() then raise exception 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then
    raise exception 'ต้องมีรายการที่ต้องการอย่างน้อย 1 รายการ';
  end if;
  if jsonb_array_length(coalesce(p->'invited','[]'::jsonb)) = 0 then
    raise exception 'ต้องเชิญซัพพลายเออร์อย่างน้อย 1 ราย';
  end if;
  if (p->>'closes_at')::timestamptz <= now() then
    raise exception 'เวลาปิดรับต้องเป็นเวลาในอนาคต';
  end if;

  v_code := public.next_tender_code();

  insert into public.tenders (code, title, description, type, budget, closes_at, created_by)
  values (v_code, p->>'title', p->>'description', p->>'type',
          (p->>'budget')::numeric, (p->>'closes_at')::timestamptz, auth.uid())
  returning id into v_id;

  insert into public.tender_internal (tender_id, target_price)
  values (v_id, nullif(p->>'target_price','')::numeric);

  insert into public.tender_items (tender_id, name, spec, qty, unit, sort)
  select v_id, i->>'name', i->>'spec', (i->>'qty')::numeric,
         coalesce(nullif(i->>'unit',''),'ชิ้น'), (ord - 1)
  from jsonb_array_elements(p->'items') with ordinality as t(i, ord);

  insert into public.tender_required_docs (tender_id, label, sort)
  select v_id, (d #>> '{}'), (ord - 1)
  from jsonb_array_elements(coalesce(p->'required_docs','[]'::jsonb)) with ordinality as t(d, ord);

  insert into public.tender_invites (tender_id, supplier_id)
  select v_id, (s.value #>> '{}')::uuid
  from jsonb_array_elements(p->'invited') as s;

  insert into public.tender_files (tender_id, file_name, file_path, size_bytes, uploaded_by)
  select v_id, f->>'file_name', f->>'file_path', nullif(f->>'size_bytes','')::bigint, auth.uid()
  from jsonb_array_elements(coalesce(p->'files','[]'::jsonb)) f;

  insert into public.tender_events (tender_id, actor_id, kind, message)
  values (v_id, auth.uid(), 'publish',
          'ประกาศเชิญประมูลใหม่ ' || v_code || ' — เชิญ ' ||
          jsonb_array_length(p->'invited') || ' ราย');

  return v_id;
end $$;

-- ---------- แนบเอกสารประกอบทีหลัง (งานเปิดราคา) ----------
create or replace function public.attach_bid_files(p_tender uuid, p_files jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_bid public.bids; v_t public.tenders; v_n int;
begin
  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;
  if v_t.awarded_bid_id is not null then raise exception 'ประกาศผลผู้ชนะแล้ว แนบเอกสารเพิ่มไม่ได้'; end if;

  select * into v_bid from public.bids
   where tender_id = p_tender and supplier_id = public.my_supplier_id();
  if v_bid.id is null then raise exception 'ต้องยื่นราคาก่อนจึงจะแนบเอกสารได้'; end if;

  insert into public.bid_files (bid_id, file_name, file_path, size_bytes)
  select v_bid.id, f->>'file_name', f->>'file_path', nullif(f->>'size_bytes','')::bigint
  from jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) f;

  select count(*) into v_n from public.bid_files where bid_id = v_bid.id;

  insert into public.tender_events (tender_id, actor_id, kind, message, buyer_only)
  select p_tender, auth.uid(), 'docs',
         s.name || ' แนบเอกสารประกอบ ' || v_n || '/' ||
         (select count(*) from public.tender_required_docs where tender_id = p_tender) || ' รายการ',
         true
  from public.suppliers s where s.id = public.my_supplier_id();

  return v_n;
end $$;

-- ---------- ผู้ขายกดสละสิทธิ์ ----------
create or replace function public.decline_invite(p_tender uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s uuid := public.my_supplier_id();
begin
  if v_s is null then raise exception 'บัญชีนี้ไม่ใช่ผู้ขาย'; end if;
  update public.tender_invites set declined_at = now()
   where tender_id = p_tender and supplier_id = v_s;

  insert into public.tender_events (tender_id, actor_id, kind, message, buyer_only)
  select p_tender, auth.uid(), 'decline', s.name || ' ขอสละสิทธิ์ในงานนี้', true
  from public.suppliers s where s.id = v_s;
end $$;

grant execute on function
  public.next_tender_code, public.tender_bid_count, public.hammer_holder,
  public.submit_bid, public.unseal_tender, public.award_bid,
  public.create_tender, public.decline_invite, public.attach_bid_files,
  public.my_target_status, public.my_hammer_state,
  public.mark_password_changed, public.must_change_password
to authenticated;

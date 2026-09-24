-- ============================================================================
-- ปิดความเคลื่อนไหวเรื่องราคาไม่ให้ผู้ขายเห็น
--
-- ปัญหา: กระดานราคาสดปิดชื่อคู่แข่งเป็น "ผู้เสนอราคา A/B/C" เรียบร้อย
--        แต่ฟีดความเคลื่อนไหวกลับประกาศชื่อบริษัทจริงคู่กับราคา
--        ผู้ขายจึงเอาสองอย่างมาเทียบกันแล้วรู้ได้ว่าใครเป็นใคร และใครเข้ามาสู้ราคาบ้าง
--
-- แก้: เหตุการณ์ยื่นราคา/ปรับราคา/ประกาศผู้ชนะ ตั้ง buyer_only = true ทั้งหมด
--      (RLS ที่ events_read กันให้เองอยู่แล้ว ผู้ขายจะอ่านไม่ได้แม้ยิง API ตรง)
--      พร้อมย้อนปิดเหตุการณ์เก่าที่ค้างอยู่ในระบบด้วย
--
-- รันซ้ำได้ ไม่ลบข้อมูล
--   cat ~/Desktop/supplier-bidding/app/supabase/20_hide_bid_events.sql | pbcopy
-- ============================================================================

-- ---------- 1) ปิดเหตุการณ์เก่าที่เคยเปิดไว้ ----------
update public.tender_events
   set buyer_only = true
 where kind in ('bid', 'rebid', 'award') and buyer_only = false;

-- ---------- 2) ของใหม่ปิดตั้งแต่ต้นทาง ----------
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
  if v_t.cancelled_at is not null then raise exception 'ประกาศนี้ถูกยกเลิกแล้ว'; end if;

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
         -- ปิดจากผู้ขายทุกกรณี ไม่ว่างานเปิดหรือปิดราคา
         -- กระดานราคาสดปิดชื่อคู่แข่งเป็น "ผู้เสนอราคา A/B/C" อยู่แล้ว
         -- ถ้าปล่อยให้ความเคลื่อนไหวโชว์ชื่อบริษัทจริงคู่กับราคา ก็เท่ากับเฉลยว่าใครเป็นใคร
         true
  from public.suppliers s where s.id = v_supplier;

  return v_bid.id;
end $$;

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

  insert into public.tender_events (tender_id, actor_id, kind, message, buyer_only)
  select v_t.id, auth.uid(), 'award',
         'ประกาศผู้ชนะ ' || v_t.code || ': ' || s.name || ' ที่ ฿' || to_char(v_b.total,'FM999,999,999'),
         true          -- เฉลยชื่อผู้ชนะพร้อมราคา ให้เห็นเฉพาะฝ่ายจัดซื้อ
  from public.suppliers s where s.id = v_b.supplier_id;
end $$;

-- ---------- 3) ตรวจผล: ต้องได้ 0 ----------
select count(*) as "เหตุการณ์เรื่องราคาที่ผู้ขายยังเห็นได้"
from public.tender_events
where kind in ('bid', 'rebid', 'award') and buyer_only = false;

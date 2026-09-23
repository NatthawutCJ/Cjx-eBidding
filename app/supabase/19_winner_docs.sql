-- ============================================================================
-- ให้ผู้ชนะส่งเอกสารได้หลังประกาศผล
--
-- ปัญหา: attach_bid_files() เดิมปฏิเสธทุกคนทันทีที่ประกาศผู้ชนะ
--        แต่ตามงานจริงฝ่ายจัดซื้อประกาศผลก่อน แล้วผู้ชนะค่อยตามส่งเอกสาร
--        (ใบเสนอราคาลงนาม / Spec) ผู้ชนะจึงอัปโหลดไม่ได้เลย
--
-- แก้: ประกาศผลแล้ว *ผู้ชนะ* ยังแนบเอกสารได้ ส่วนรายที่ไม่ได้รับเลือกถูกปิด
--      ประกาศที่ถูกยกเลิกยังปิดเหมือนเดิม
--
-- รันซ้ำได้ ไม่แตะข้อมูล
--   cat ~/Desktop/supplier-bidding/app/supabase/19_winner_docs.sql | pbcopy
-- ============================================================================

create or replace function public.attach_bid_files(p_tender uuid, p_files jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_bid public.bids; v_t public.tenders; v_n int;
begin
  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;
  if v_t.cancelled_at is not null then raise exception 'ประกาศนี้ถูกยกเลิกแล้ว'; end if;

  select * into v_bid from public.bids
   where tender_id = p_tender and supplier_id = public.my_supplier_id();
  if v_bid.id is null then raise exception 'ต้องยื่นราคาก่อนจึงจะแนบเอกสารได้'; end if;

  -- ประกาศผลแล้ว: ผู้ชนะยังต้องส่งเอกสารต่อได้ (ตามจริงเอกสารมักตามมาหลังประกาศผล)
  -- ส่วนรายที่ไม่ได้รับเลือก ปิดรับ ไม่ต้องส่งอะไรเพิ่ม
  if v_t.awarded_bid_id is not null and v_t.awarded_bid_id <> v_bid.id then
    raise exception 'ประกาศผลผู้ชนะแล้ว รายที่ไม่ได้รับเลือกไม่ต้องส่งเอกสารเพิ่ม';
  end if;

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

-- ตรวจผล: ต้องได้ true
select pg_get_functiondef(p.oid) like '%รายที่ไม่ได้รับเลือก%' as "ผู้ชนะส่งเอกสารหลังประกาศผลได้แล้ว"
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'attach_bid_files';

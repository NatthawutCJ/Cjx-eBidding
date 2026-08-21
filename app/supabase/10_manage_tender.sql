-- ============================================================================
-- ยกเลิก / ลบ ประกาศประมูล
--
-- แยกเป็น 2 อย่างโดยตั้งใจ
--   ยกเลิก (cancel) — เก็บประวัติไว้ทั้งหมด พร้อมเหตุผล ใช้ได้ทุกกรณี
--                     เหมาะกับงานที่มีคนยื่นราคาแล้ว เพราะการลบทิ้งคือการทำลายหลักฐาน
--   ลบ (delete)     — ลบออกจริง อนุญาตเฉพาะประกาศที่ยังไม่มีใครยื่นราคา
--                     (เช่น สร้างผิด กรอกผิด) ทุกครั้งที่ลบถูกบันทึกใน admin_actions
--
--   cat ~/Desktop/supplier-bidding/app/supabase/10_manage_tender.sql | pbcopy
-- ============================================================================

alter table public.tenders add column if not exists cancelled_at  timestamptz;
alter table public.tenders add column if not exists cancelled_by  uuid references public.profiles(id);
alter table public.tenders add column if not exists cancel_reason text;

-- สถานะงาน: เพิ่ม cancelled ไว้บนสุด
create or replace function public.tender_status(t public.tenders)
returns text language sql stable as $$
  select case
    when t.cancelled_at is not null   then 'cancelled'
    when t.awarded_bid_id is not null then 'awarded'
    when now() > t.closes_at          then 'closed'
    when now() < t.opens_at           then 'scheduled'
    else 'live'
  end
$$;

-- ---------- ยกเลิกประกาศ ----------
create or replace function public.cancel_tender(p_tender uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tenders;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;
  if length(coalesce(trim(p_reason),'')) < 5 then
    raise exception 'ต้องระบุเหตุผลการยกเลิกอย่างน้อย 5 ตัวอักษร เพื่อให้ผู้ขายทราบและตรวจย้อนหลังได้';
  end if;

  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;
  if v_t.cancelled_at is not null then raise exception 'ประกาศนี้ถูกยกเลิกไปแล้ว'; end if;
  if v_t.awarded_bid_id is not null then
    raise exception 'ประกาศนี้ประกาศผู้ชนะแล้ว ยกเลิกไม่ได้ (ถ้าจำเป็นต้องยกเลิก PO ให้ทำนอกระบบ)';
  end if;

  update public.tenders
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_tender;

  -- ผู้ขายทุกรายเห็นเหตุผลนี้ (ไม่ใช่ buyer_only) เพราะกระทบเขาโดยตรง
  insert into public.tender_events (tender_id, actor_id, kind, message)
  values (p_tender, auth.uid(), 'cancel',
          'ยกเลิกประกาศ ' || v_t.code || ' — เหตุผล: ' || trim(p_reason));

  insert into public.admin_actions (actor_id, action, note)
  values (auth.uid(), 'cancel_tender', v_t.code || ' — ' || trim(p_reason));
end $$;

-- ---------- ลบประกาศ (เฉพาะที่ยังไม่มีใครยื่นราคา) ----------
create or replace function public.delete_tender(p_tender uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tenders; v_bids int;
begin
  if not public.is_buyer() then raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้น'; end if;

  select * into v_t from public.tenders where id = p_tender;
  if v_t.id is null then raise exception 'ไม่พบประกาศนี้'; end if;

  select count(*) into v_bids from public.bids where tender_id = p_tender;
  if v_bids > 0 then
    raise exception 'ประกาศนี้มีใบเสนอราคาแล้ว % ราย จึงลบไม่ได้ — ใช้ "ยกเลิกประกาศ" แทน เพื่อเก็บหลักฐานไว้', v_bids;
  end if;

  insert into public.admin_actions (actor_id, action, note)
  values (auth.uid(), 'delete_tender', v_t.code || ' — ' || v_t.title);

  -- ตารางลูกทั้งหมดผูกด้วย on delete cascade จึงหายไปพร้อมกัน
  delete from public.tenders where id = p_tender;
end $$;

-- ---------- ห้ามยื่นราคาในประกาศที่ถูกยกเลิก ----------
-- (เพิ่มเงื่อนไขใน submit_bid และ attach_bid_files)
create or replace function public.assert_tender_active(p_tender uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.tenders where id = p_tender and cancelled_at is not null) then
    raise exception 'ประกาศนี้ถูกยกเลิกแล้ว';
  end if;
end $$;

grant execute on function
  public.cancel_tender, public.delete_tender, public.assert_tender_active
to authenticated;

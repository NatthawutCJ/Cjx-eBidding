-- ============================================================================
-- หมายเหตุถึงผู้ขาย (remark) — ข้อความอิสระที่ฝ่ายจัดซื้อพิมพ์ตอนสร้างประกาศ
--
-- ใช้บอกเงื่อนไขที่ไม่เข้าพวกกับช่องอื่น เช่น เงื่อนไขการชำระเงิน สถานที่ส่งมอบ
-- ข้อกำหนดพิเศษ หรือคำเตือนที่อยากให้ผู้ขายอ่านก่อนเสนอราคา
--
-- *** ผู้ขายที่ถูกเชิญทุกรายอ่านข้อความนี้ได้ ห้ามใส่ราคาคาดหวังหรืองบประมาณลงไป ***
-- (งบและราคาคาดหวังอยู่ในตาราง tender_internal ที่ผู้ขายอ่านไม่ได้ อย่าย้ายมาไว้ที่นี่)
--
-- รันซ้ำได้ ไม่แตะข้อมูลเดิม ประกาศเก่าจะมี remark = null ซึ่งหน้าเว็บไม่แสดงอะไร
--   cat ~/Desktop/supplier-bidding/app/supabase/16_remark.sql | pbcopy
-- ============================================================================

alter table public.tenders add column if not exists remark text;

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
  -- ช่วงเวลาประมูล: เปิดรับ (ไม่ใส่ = เปิดทันที) ต้องมาก่อนปิดรับเสมอ
  if nullif(p->>'opens_at','') is not null
     and (p->>'opens_at')::timestamptz >= (p->>'closes_at')::timestamptz then
    raise exception 'เวลาเปิดรับราคาต้องมาก่อนเวลาปิดรับ';
  end if;
  if coalesce((p->>'budget')::numeric, 0) <= 0 then
    raise exception 'ต้องระบุงบประมาณ';
  end if;

  v_code := public.next_tender_code();

  insert into public.tenders (code, title, description, type, remark, opens_at, closes_at, created_by)
  values (v_code, p->>'title', p->>'description', p->>'type',
          left(nullif(btrim(p->>'remark'), ''), 2000),
          coalesce(nullif(p->>'opens_at','')::timestamptz, now()),
          (p->>'closes_at')::timestamptz, auth.uid())
  returning id into v_id;

  -- งบประมาณและราคาคาดหวังอยู่ในตารางของฝ่ายจัดซื้อ ผู้ขายอ่านไม่ได้
  insert into public.tender_internal (tender_id, budget, target_price)
  values (v_id, (p->>'budget')::numeric, nullif(p->>'target_price','')::numeric);

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

-- ตรวจผล: ต้องได้ true ทั้งคู่
select
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='tenders' and column_name='remark')  as "มีคอลัมน์ remark",
  pg_get_functiondef(p.oid) like '%remark%'                                               as "create_tender รับ remark แล้ว"
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_tender';

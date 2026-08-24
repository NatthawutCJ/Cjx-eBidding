-- ============================================================================
-- ซ่อนงบประมาณจากผู้ขาย
--
-- ปัญหา: budget เคยเป็นคอลัมน์ในตาราง tenders ซึ่งผู้ขายที่ถูกเชิญอ่านได้
--        (RLS กันได้ทีละแถว ไม่ใช่ทีละคอลัมน์) ผู้ขายที่ยิง API ตรงจึงรู้งบเราได้
--        แล้วเสนอราคาชิดเพดานงบ ซึ่งทำให้เสียเปรียบในการประมูล
--
-- ทางแก้: ย้าย budget ไปอยู่ตาราง tender_internal ที่มีนโยบายให้เฉพาะฝ่ายจัดซื้อ
--        ที่เดียวกับราคาคาดหวัง แล้วลบคอลัมน์เดิมทิ้ง — ไม่เหลือช่องให้หลุด
--
-- ไฟล์นี้รันซ้ำได้ ข้อมูลประมูลเดิมไม่หาย (ย้ายค่างบของทุกงานไปให้เรียบร้อย)
--   cat ~/Desktop/supplier-bidding/app/supabase/12_hide_budget.sql | pbcopy
-- ============================================================================

-- ---------- 1) เพิ่มคอลัมน์ในตารางลับ ----------
alter table public.tender_internal
  add column if not exists budget numeric(14,2) check (budget > 0);

-- ---------- 2) ย้ายค่าเดิมทั้งหมด แล้วลบคอลัมน์ที่ผู้ขายอ่านได้ ----------
do $mig$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tenders'
               and column_name = 'budget') then

    insert into public.tender_internal (tender_id, budget)
    select t.id, t.budget from public.tenders t
    on conflict (tender_id) do update set budget = excluded.budget;

    alter table public.tenders drop column budget;
    raise notice 'ย้ายงบประมาณเข้า tender_internal และลบคอลัมน์ tenders.budget แล้ว';
  else
    raise notice 'ย้ายไปแล้วก่อนหน้านี้ ไม่ต้องทำอะไร';
  end if;
end $mig$;

-- งานทุกงานต้องมีงบ (แถวใน tender_internal ถูกสร้างพร้อมประกาศอยู่แล้ว)
alter table public.tender_internal alter column budget set not null;

-- ---------- 3) สร้างประกาศ: เขียนงบลงตารางลับแทน ----------
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
  if coalesce((p->>'budget')::numeric, 0) <= 0 then
    raise exception 'ต้องระบุงบประมาณ';
  end if;

  v_code := public.next_tender_code();

  insert into public.tenders (code, title, description, type, closes_at, created_by)
  values (v_code, p->>'title', p->>'description', p->>'type',
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

-- ---------- 4) ตรวจว่าปิดสนิทจริง ----------
-- ควรได้ 0 แถว ถ้ายังมีแถวออกมาแปลว่าคอลัมน์เก่ายังอยู่
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tenders' and column_name = 'budget';

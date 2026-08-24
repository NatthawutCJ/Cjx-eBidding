-- ============================================================================
-- ระบบประมูลจัดซื้อ CJx — ติดตั้งฐานข้อมูลทั้งหมดในไฟล์เดียว
--
-- วิธีใช้ที่ปลอดภัยที่สุด (กันปัญหาวางไม่ครบไฟล์)
--   1) เปิด Terminal รัน:  cat ~/Desktop/supplier-bidding/app/supabase/00_all_in_one.sql | pbcopy
--      คำสั่งนี้คัดลอกไฟล์ทั้งไฟล์เข้าคลิปบอร์ดแบบตรงตัว ไม่มีตกหล่น
--   2) ไปที่ Supabase > SQL Editor > New query แล้วกด ⌘V
--   3) กดที่พื้นที่ว่างในหน้าต่างหนึ่งครั้ง (ไม่ให้มีข้อความถูกเลือกค้างไว้)
--      *** ถ้ามีข้อความถูกเลือกอยู่ Supabase จะรันเฉพาะส่วนที่เลือก ***
--   4) กด Run
--
-- ไฟล์นี้ลบโครงเดิมทิ้งก่อนสร้างใหม่ จึงรันซ้ำได้ไม่จำกัดในช่วงติดตั้ง
-- *** ห้ามรันหลังเริ่มใช้งานจริง เพราะข้อมูลประมูลทั้งหมดจะหาย ***
-- ============================================================================

-- ---------- ล้างของเดิม ----------
drop table if exists
  public.tender_events, public.bid_files, public.bid_lines, public.bids,
  public.tender_files, public.tender_required_docs, public.tender_invites,
  public.tender_items, public.tender_internal, public.tenders,
  public.profiles, public.suppliers cascade;

drop function if exists
  public.app_role, public.is_buyer, public.my_supplier_id, public.is_invited,
  public.can_see_prices, public.can_see_tender, public.tender_status,
  public.next_tender_code, public.tender_bid_count, public.hammer_holder,
  public.submit_bid, public.unseal_tender, public.award_bid, public.create_tender,
  public.decline_invite, public.attach_bid_files, public.my_target_status,
  public.my_hammer_state, public.mark_password_changed, public.must_change_password,
  public.try_uuid cascade;

drop policy if exists "tender files read"   on storage.objects;
drop policy if exists "tender files write"  on storage.objects;
drop policy if exists "tender files delete" on storage.objects;
drop policy if exists "bid files read"      on storage.objects;
drop policy if exists "bid files write"     on storage.objects;
drop policy if exists "bid files delete"    on storage.objects;



-- ############################################################################
-- ส่วนที่ 1 — ตาราง  (01_schema.sql)
-- ############################################################################

-- ============================================================================
-- ระบบประมูลจัดซื้อซัพพลายเออร์ (Supplier e-Bidding) — โครงสร้างฐานข้อมูล
-- รันไฟล์นี้ก่อน ที่ Supabase Dashboard > SQL Editor
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------- บริษัทผู้ขาย ----------
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                       -- V-1042
  name        text not null,
  tax_id      text,
  status      text not null default 'active'
              check (status in ('active','pending','suspended')),
  created_at  timestamptz not null default now()
);

-- ---------- ผู้ใช้ (ผูกกับ auth.users) ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('buyer','supplier')),
  full_name   text not null,
  position    text,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  -- ฝ่ายจัดซื้อเป็นคนตั้งรหัสผ่านครั้งแรกให้ จึงต้องบังคับให้เจ้าของบัญชีเปลี่ยนก่อนใช้งาน
  -- ไม่ใช่แค่กันที่หน้าจอ แต่ submit_bid()/create_tender() จะปฏิเสธด้วยถ้ายังไม่เปลี่ยน
  must_change_password boolean not null default true,
  password_changed_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- ผู้ขายต้องสังกัดบริษัท ฝ่ายจัดซื้อต้องไม่สังกัด
  constraint profile_company_rule check (
    (role = 'supplier' and supplier_id is not null) or
    (role = 'buyer'    and supplier_id is null)
  )
);

-- ---------- ประกาศเชิญประมูล ----------
-- ไม่มีคอลัมน์ budget ในตารางนี้ — งบประมาณอยู่ใน tender_internal ที่ผู้ขายอ่านไม่ได้
create table public.tenders (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,                    -- RFQ_2026_08_001
  title          text not null,
  description    text,
  type           text not null check (type in ('sealed','open')),
  currency       text not null default 'THB',
  opens_at       timestamptz not null default now(),
  closes_at      timestamptz not null,
  unsealed_at    timestamptz,                             -- เวลาเปิดซอง (งานปิดราคา)
  unsealed_by    uuid references public.profiles(id),
  awarded_bid_id uuid,                                    -- FK เพิ่มท้ายไฟล์ (วนกับ bids)
  awarded_at     timestamptz,
  awarded_by     uuid references public.profiles(id),
  cancelled_at   timestamptz,                             -- ยกเลิกประกาศ (เก็บประวัติไว้ ไม่ลบ)
  cancelled_by   uuid references public.profiles(id),
  cancel_reason  text,
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint close_after_open check (closes_at > opens_at)
);

-- ---------- งบประมาณ + ราคาคาดหวัง: แยกตารางเพื่อให้ RLS กันผู้ขายได้เด็ดขาด ----------
-- ถ้าเก็บเป็นคอลัมน์ใน tenders ผู้ขายที่ยิง API ตรงจะ select เอาไปได้
-- (RLS กันได้ทั้งแถว แต่กันทีละคอลัมน์ไม่ได้) จึงต้องแยกออกมาเป็นตารางของฝ่ายจัดซื้อ
create table public.tender_internal (
  tender_id     uuid primary key references public.tenders(id) on delete cascade,
  budget        numeric(14,2) not null check (budget > 0),
  target_price  numeric(14,2) check (target_price > 0),
  internal_note text
);

-- ---------- รายการที่ต้องเสนอราคา ----------
create table public.tender_items (
  id        uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  name      text not null,
  spec      text,
  qty       numeric(14,3) not null check (qty > 0),
  unit      text not null default 'ชิ้น',
  sort      int not null default 0
);
create index on public.tender_items (tender_id);

-- ---------- ผู้ถูกเชิญ ----------
create table public.tender_invites (
  tender_id   uuid not null references public.tenders(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  invited_at  timestamptz not null default now(),
  declined_at timestamptz,                                -- กดสละสิทธิ์
  primary key (tender_id, supplier_id)
);
create index on public.tender_invites (supplier_id);

-- ---------- เอกสารที่ผู้ขายต้องแนบกลับ (แค่รายการชื่อ) ----------
create table public.tender_required_docs (
  id        uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  label     text not null,
  sort      int not null default 0
);
create index on public.tender_required_docs (tender_id);

-- ---------- ไฟล์ TOR/สเปก ที่ผู้ซื้อแนบไปกับประกาศ ----------
create table public.tender_files (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references public.tenders(id) on delete cascade,
  file_name   text not null,
  file_path   text not null,                              -- path ใน storage bucket 'tender-files'
  size_bytes  bigint,
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index on public.tender_files (tender_id);

-- ---------- ใบเสนอราคา ----------
create table public.bids (
  id           uuid primary key default gen_random_uuid(),
  tender_id    uuid not null references public.tenders(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  total        numeric(14,2) not null check (total > 0),   -- คำนวณฝั่ง server เท่านั้น
  note         text,
  version      int not null default 1,                    -- จำนวนครั้งที่แก้ราคา (งานเปิดราคา)
  submitted_at timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  unique (tender_id, supplier_id)                          -- 1 บริษัท 1 ใบต่อ 1 งาน
);
create index on public.bids (tender_id, total);

create table public.bid_lines (
  id         uuid primary key default gen_random_uuid(),
  bid_id     uuid not null references public.bids(id) on delete cascade,
  item_id    uuid not null references public.tender_items(id) on delete cascade,
  unit_price numeric(14,4) not null check (unit_price > 0),
  unique (bid_id, item_id)
);

create table public.bid_files (
  id         uuid primary key default gen_random_uuid(),
  bid_id     uuid not null references public.bids(id) on delete cascade,
  file_name  text not null,
  file_path  text not null,                               -- path ใน bucket 'bid-files'
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index on public.bid_files (bid_id);

-- ---------- บันทึกความเคลื่อนไหว / audit ----------
create table public.tender_events (
  id         uuid primary key default gen_random_uuid(),
  tender_id  uuid not null references public.tenders(id) on delete cascade,
  actor_id   uuid references public.profiles(id),
  kind       text not null,                               -- bid | rebid | unseal | award | publish | decline
  message    text not null,
  buyer_only boolean not null default false,              -- true = ผู้ขายไม่เห็นบรรทัดนี้
  created_at timestamptz not null default now()
);
create index on public.tender_events (tender_id, created_at desc);

alter table public.tenders
  add constraint tenders_awarded_bid_fk
  foreign key (awarded_bid_id) references public.bids(id) on delete set null;

-- ---------- สถานะงาน (คำนวณจากเวลา ไม่เก็บซ้ำ) ----------
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

-- realtime: ให้ client subscribe การเปลี่ยนแปลงของ bids และ events ได้
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.tender_events;


-- ############################################################################
-- ส่วนที่ 2 — Row Level Security  (02_rls.sql)
-- ############################################################################

-- ============================================================================
-- Row Level Security — หัวใจของระบบนี้
-- กติกาที่บังคับที่ระดับฐานข้อมูล (ไม่ใช่แค่ซ่อนใน UI):
--   1. งานปิดราคา (sealed): ไม่มีใครอ่านราคาของคนอื่นได้เลย จนกดเปิดซอง
--      แม้แต่ฝ่ายจัดซื้อ และเปิดซองได้หลังเวลาปิดรับเท่านั้น
--   2. งานเปิดราคา (open): ผู้ถูกเชิญเห็นราคาของกันได้แบบเรียลไทม์
--   3. ราคาคาดหวัง: อ่านได้เฉพาะฝ่ายจัดซื้อ
--   4. ผู้ขายเห็นเฉพาะงานที่ถูกเชิญ และเห็นใบเสนอราคาของบริษัทตัวเองเท่านั้น
-- ============================================================================

-- ---------- ฟังก์ชันช่วย (security definer = อ่านตารางได้โดยไม่ติด RLS ของตัวเอง) ----------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_buyer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'buyer', false)
$$;

create or replace function public.my_supplier_id() returns uuid
language sql stable security definer set search_path = public as $$
  select supplier_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_invited(p_tender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tender_invites i
    where i.tender_id = p_tender and i.supplier_id = public.my_supplier_id()
  )
$$;

-- เห็นราคาของผู้อื่นได้หรือยัง: งานเปิดราคา = ได้เสมอ / งานปิดราคา = หลังเปิดซองเท่านั้น
create or replace function public.can_see_prices(p_tender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenders t
    where t.id = p_tender
      and (t.type = 'open' or t.unsealed_at is not null)
  )
$$;

-- มองเห็นตัวประกาศได้ไหม (ใช้ซ้ำหลายตาราง)
create or replace function public.can_see_tender(p_tender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or (
    public.is_invited(p_tender)
    and exists (select 1 from public.tenders t where t.id = p_tender and t.opens_at <= now())
  )
$$;

-- ---------- เปิด RLS ทุกตาราง ----------
alter table public.suppliers            enable row level security;
alter table public.profiles             enable row level security;
alter table public.tenders              enable row level security;
alter table public.tender_internal      enable row level security;
alter table public.tender_items         enable row level security;
alter table public.tender_invites       enable row level security;
alter table public.tender_required_docs enable row level security;
alter table public.tender_files         enable row level security;
alter table public.bids                 enable row level security;
alter table public.bid_lines            enable row level security;
alter table public.bid_files            enable row level security;
alter table public.tender_events        enable row level security;

-- ---------- profiles / suppliers ----------
create policy profiles_self on public.profiles
  for select using (id = auth.uid() or public.is_buyer());

create policy suppliers_read on public.suppliers
  for select using (public.is_buyer() or id = public.my_supplier_id());

create policy suppliers_buyer_write on public.suppliers
  for all using (public.is_buyer()) with check (public.is_buyer());

-- ---------- tenders ----------
create policy tenders_read on public.tenders
  for select using (public.can_see_tender(id));

create policy tenders_buyer_insert on public.tenders
  for insert with check (public.is_buyer());

-- ผู้ซื้อแก้ได้เฉพาะงานที่ยังไม่ปิดรับ และ "ห้าม" ยิง update เพื่อเปิดซอง/ประกาศผลเอง
-- (สองอย่างนั้นต้องผ่านฟังก์ชัน unseal_tender / award_bid เท่านั้น — ดู 03_functions.sql)
create policy tenders_buyer_update on public.tenders
  for update using (public.is_buyer() and now() < closes_at and awarded_bid_id is null)
  with check (public.is_buyer() and unsealed_at is null and awarded_bid_id is null);

-- ---------- ราคาคาดหวัง: ฝ่ายจัดซื้อเท่านั้น (ไม่มี policy ให้ผู้ขาย = อ่านไม่ได้) ----------
create policy tender_internal_buyer on public.tender_internal
  for all using (public.is_buyer()) with check (public.is_buyer());

-- ---------- ตารางลูกของประกาศ: เห็นตามตัวประกาศ ----------
create policy items_read on public.tender_items
  for select using (public.can_see_tender(tender_id));
create policy items_buyer_write on public.tender_items
  for all using (public.is_buyer()) with check (public.is_buyer());

create policy reqdocs_read on public.tender_required_docs
  for select using (public.can_see_tender(tender_id));
create policy reqdocs_buyer_write on public.tender_required_docs
  for all using (public.is_buyer()) with check (public.is_buyer());

create policy tfiles_read on public.tender_files
  for select using (public.can_see_tender(tender_id));
create policy tfiles_buyer_write on public.tender_files
  for all using (public.is_buyer()) with check (public.is_buyer());

create policy invites_read on public.tender_invites
  for select using (public.is_buyer() or supplier_id = public.my_supplier_id());
create policy invites_buyer_write on public.tender_invites
  for all using (public.is_buyer()) with check (public.is_buyer());
-- ผู้ขายกดสละสิทธิ์งานของตัวเองได้
create policy invites_decline on public.tender_invites
  for update using (supplier_id = public.my_supplier_id())
  with check (supplier_id = public.my_supplier_id());

-- ---------- ใบเสนอราคา: กฎที่สำคัญที่สุด ----------
-- อ่านได้เมื่อ (ก) เป็นใบของบริษัทตัวเอง หรือ (ข) ถึงเวลาที่เปิดเผยราคาได้แล้ว
-- ฝ่ายจัดซื้อก็อยู่ใต้กฎข้อ (ข) เช่นกัน จึงอ่านราคาก่อนเปิดซองไม่ได้
create policy bids_read on public.bids
  for select using (
    (supplier_id = public.my_supplier_id())
    or (public.can_see_prices(tender_id) and public.can_see_tender(tender_id))
  );
-- ไม่มี policy insert/update/delete โดยตั้งใจ — ยื่นราคาต้องผ่าน submit_bid() เท่านั้น
-- เพื่อให้ยอดรวมถูกคำนวณฝั่ง server และบันทึกจำนวนครั้งที่แก้ราคา (version)

create policy bidlines_read on public.bid_lines
  for select using (exists (select 1 from public.bids b where b.id = bid_id));

create policy bidfiles_read on public.bid_files
  for select using (exists (select 1 from public.bids b where b.id = bid_id));

-- ---------- ความเคลื่อนไหว ----------
create policy events_read on public.tender_events
  for select using (
    public.can_see_tender(tender_id) and (public.is_buyer() or buyer_only = false)
  );

-- ---------- ปิดสิทธิ์ตรงๆ ไม่ให้ client แก้ตารางสำคัญ ----------
revoke insert, update, delete on public.bids       from anon, authenticated;
revoke insert, update, delete on public.bid_lines  from anon, authenticated;
revoke insert, update, delete on public.bid_files  from anon, authenticated;
revoke insert, update, delete on public.tender_events from anon, authenticated;


-- ############################################################################
-- ส่วนที่ 3 — ฟังก์ชัน  (03_functions.sql)
-- ############################################################################

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


-- ############################################################################
-- ส่วนที่ 4 — ไฟล์แนบ  (04_storage.sql)
-- ############################################################################

-- ============================================================================
-- ไฟล์แนบ: 2 bucket แบบ private + RLS ตาม path
--   tender-files/{tender_id}/ชื่อไฟล์               (TOR/สเปก จากผู้ซื้อ)
--   bid-files/{tender_id}/{supplier_id}/ชื่อไฟล์     (เอกสารที่ผู้ขายแนบ)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('tender-files','tender-files', false, 20971520),
       ('bid-files','bid-files', false, 20971520)
on conflict (id) do nothing;

-- แปลง text -> uuid แบบไม่ error ถ้า path ไม่ถูกรูปแบบ
create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin return t::uuid; exception when others then return null; end $$;

-- ---------- TOR จากผู้ซื้อ: ผู้ถูกเชิญทุกรายดาวน์โหลดได้ ----------
create policy "tender files read" on storage.objects for select
using (
  bucket_id = 'tender-files'
  and public.can_see_tender(public.try_uuid((storage.foldername(name))[1]))
);

create policy "tender files write" on storage.objects for insert
with check (bucket_id = 'tender-files' and public.is_buyer());

create policy "tender files delete" on storage.objects for delete
using (bucket_id = 'tender-files' and public.is_buyer());

-- ---------- เอกสารของผู้ขาย: เจ้าของอ่านได้เสมอ ผู้ซื้ออ่านได้เมื่อถึงเวลาเปิดเผยราคา ----------
create policy "bid files read" on storage.objects for select
using (
  bucket_id = 'bid-files'
  and (
    public.try_uuid((storage.foldername(name))[2]) = public.my_supplier_id()
    or (
      public.can_see_prices(public.try_uuid((storage.foldername(name))[1]))
      and public.can_see_tender(public.try_uuid((storage.foldername(name))[1]))
    )
  )
);

create policy "bid files write" on storage.objects for insert
with check (
  bucket_id = 'bid-files'
  and public.try_uuid((storage.foldername(name))[2]) = public.my_supplier_id()
  and public.is_invited(public.try_uuid((storage.foldername(name))[1]))
);

-- ผู้ขายลบไฟล์ของตัวเองได้ก่อนหมดเวลา (แก้ไฟล์ที่แนบผิด)
create policy "bid files delete" on storage.objects for delete
using (
  bucket_id = 'bid-files'
  and public.try_uuid((storage.foldername(name))[2]) = public.my_supplier_id()
);


-- ============================================================================
-- เสร็จแล้ว ถ้าขึ้น Success. No rows returned ถือว่าผ่าน
-- ขั้นถัดไป: สร้างผู้ใช้ใน Authentication > Users แล้วรัน 05_seed.sql
-- ============================================================================

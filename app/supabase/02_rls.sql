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

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
  created_at  timestamptz not null default now(),
  -- ผู้ขายต้องสังกัดบริษัท ฝ่ายจัดซื้อต้องไม่สังกัด
  constraint profile_company_rule check (
    (role = 'supplier' and supplier_id is not null) or
    (role = 'buyer'    and supplier_id is null)
  )
);

-- ---------- ประกาศเชิญประมูล ----------
create table public.tenders (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,                    -- RFQ_2026_08_001
  title          text not null,
  description    text,
  type           text not null check (type in ('sealed','open')),
  budget         numeric(14,2) not null check (budget > 0),
  currency       text not null default 'THB',
  opens_at       timestamptz not null default now(),
  closes_at      timestamptz not null,
  unsealed_at    timestamptz,                             -- เวลาเปิดซอง (งานปิดราคา)
  unsealed_by    uuid references public.profiles(id),
  awarded_bid_id uuid,                                    -- FK เพิ่มท้ายไฟล์ (วนกับ bids)
  awarded_at     timestamptz,
  awarded_by     uuid references public.profiles(id),
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint close_after_open check (closes_at > opens_at)
);

-- ---------- ราคาคาดหวัง: แยกตารางเพื่อให้ RLS กันผู้ขายได้เด็ดขาด ----------
-- ถ้าเก็บเป็นคอลัมน์ใน tenders ผู้ขายที่ยิง API ตรงจะ select เอาไปได้
-- (RLS กันได้ทั้งแถว แต่กันทีละคอลัมน์ไม่ได้) จึงต้องแยกออกมาเป็นตารางของฝ่ายจัดซื้อ
create table public.tender_internal (
  tender_id     uuid primary key references public.tenders(id) on delete cascade,
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
    when t.awarded_bid_id is not null then 'awarded'
    when now() > t.closes_at          then 'closed'
    when now() < t.opens_at           then 'scheduled'
    else 'live'
  end
$$;

-- realtime: ให้ client subscribe การเปลี่ยนแปลงของ bids และ events ได้
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.tender_events;

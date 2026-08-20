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

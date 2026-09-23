-- ============================================================================
-- ให้ผู้ขายที่ถูกเชิญเห็นประกาศได้ก่อนถึงเวลาเปิดรับราคา
--
-- ปัญหา: can_see_tender() ตัวเดิมมีเงื่อนไข `opens_at <= now()` ผู้ขายจึง
--        มองไม่เห็นประกาศเลยจนกว่าจะถึงเวลาเปิด — พอฝ่ายจัดซื้อตั้งเวลาเปิด
--        ล่วงหน้า ผู้ขายจะไม่เห็นอะไรเลยทั้งที่ถูกเชิญแล้ว
--
-- แก้: ตัดเงื่อนไขเวลาออก ให้เห็นตั้งแต่ถูกเชิญ จะได้อ่านสเปกและโหลด TOR เตรียมราคาไว้
--      สิ่งที่ยังกันไว้เหมือนเดิม:
--        ยื่นราคาก่อนเวลาเปิดไม่ได้      → submit_bid() เช็ก now() < opens_at
--        เห็นราคาคู่แข่งในงานปิดราคาไม่ได้ → can_see_prices()
--        เห็นงบประมาณ/ราคาคาดหวังไม่ได้   → ตาราง tender_internal (ฝ่ายจัดซื้อเท่านั้น)
--
-- รันซ้ำได้ ไม่แตะข้อมูล
--   cat ~/Desktop/supplier-bidding/app/supabase/15_open_visibility.sql | pbcopy
-- ============================================================================

-- ผู้ขายที่ถูกเชิญเห็นประกาศได้ตั้งแต่ถูกเชิญ แม้ยังไม่ถึงเวลาเปิดรับราคา
-- เพราะช่วงก่อนเปิดมีไว้ให้เตรียมตัว (อ่านสเปก โหลด TOR คิดราคา)
-- การ "ยื่นราคา" ยังถูกกันด้วย submit_bid() ที่เช็ก now() < opens_at อยู่แล้ว
-- และราคาของคู่แข่งยังกันด้วย can_see_prices() แยกต่างหาก
create or replace function public.can_see_tender(p_tender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_invited(p_tender)
$$;

-- ตรวจผล: ต้องได้ false (ไม่มีเงื่อนไขเวลาหลงเหลือ)
select pg_get_functiondef(p.oid) like '%opens_at%' as "ยังมีเงื่อนไขเวลาค้างอยู่"
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'can_see_tender';

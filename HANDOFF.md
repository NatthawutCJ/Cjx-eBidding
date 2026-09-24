# HANDOFF — ระบบประมูลจัดซื้อ CJx (Supplier e-Bidding)

- **Repo**: https://github.com/NatthawutCJ/Cjx-eBidding — branch `main`
- **SHA ตอนเขียนไฟล์นี้**: `9eff930` (2026-08-24 11:21 +0700) · working tree สะอาด · push แล้ว
- **เจ้าของงาน**: Natthawut (จัดซื้อกลาง) — ส่งต่อให้ทีม IT ดูแลต่อ
- **สแต็ก**: React 18 + Vite 5 (ไม่มี router) · Supabase (Postgres + Auth + Storage + Realtime) · Cloudflare Pages
- ป้ายกำกับ: `[V]` = ตรวจสอบสดตอนเขียนไฟล์นี้ · `[?]` = ยังไม่ได้ยืนยัน ให้ตรวจก่อนเชื่อ

---

## สถานะที่ตรวจแล้ว (Verified state)

- `[V]` `cd app && npm run build` ผ่าน — vite 5.4.21, 88 modules, `dist/assets/index-*.js` 441 kB (node v24.19.0 / npm 11.17.0)
- `[V]` **ไม่มีชุดทดสอบในโปรเจกต์** — `package.json` มีแค่ `dev` / `build` / `preview` การตรวจงานทุกครั้งจึงต้องใช้ build + เปิดหน้าเว็บจริง
- `[V]` โครงไฟล์: `app/src/` 17 ไฟล์ (~1,900 บรรทัด) · `app/supabase/` 14 ไฟล์ SQL (~2,500 บรรทัด)
- `[V]` `app/.env` ถูก ignore ที่ `app/.gitignore:3` — ไม่มีคีย์หลุดเข้า git (`git ls-files` เจอแค่ `.env.example`)
- `[V]` **ฐานข้อมูลจริง** (ยิงผ่าน REST ด้วย anon key ตอนเขียนไฟล์นี้):
  - `tenders.budget` → ไม่มีแล้ว = รัน `12_hide_budget.sql` แล้ว ✅ (ผู้ขายอ่านงบไม่ได้)
  - `tenders.cancelled_at`, `cancel_reason` → มี = รัน `10_manage_tender.sql` แล้ว ✅
  - ฟังก์ชันที่ตอบว่า "เฉพาะฝ่ายจัดซื้อเท่านั้น" (= มีจริง แต่กันสิทธิ์ถูกต้อง): `admin_list_users`, `admin_pending_accounts`, `admin_link_user`, `cancel_tender`, `delete_tender`
  - `assert_tender_active` → 204 · `tender_bid_count` → 200 · `change_my_password` → "ต้องเข้าสู่ระบบก่อน" (มีครบ)
  - สรุป: ไฟล์ `01–04, 07, 09, 10, 11, 12` ถูกรันแล้วบน Supabase
- `[?]` `05_seed.sql` เคยรัน (มี 4 บัญชี + งานตัวอย่าง 2 งาน) — **ยังไม่ได้เช็คว่างานตัวอย่างถูกลบออกจาก production หรือยัง**
- `[?]` Cloudflare Pages: ตั้ง Root directory = `app`, build = `npm run build`, output = `dist`, framework preset = **None**, มี Build variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — ตั้งไว้แล้วในเซสชันก่อนหน้า แต่รอบนี้ไม่ได้เปิดหน้า dashboard ยืนยัน

---

## สิ่งที่ต้องรู้ก่อนแก้อะไร (Decisions)

- **งบประมาณ + ราคาคาดหวังอยู่ตาราง `tender_internal`** ไม่ใช่คอลัมน์ใน `tenders` เพราะ RLS ของ Postgres กันได้ทีละ**แถว** ไม่ใช่ทีละ**คอลัมน์** — ถ้าย้ายกลับไปเป็นคอลัมน์ใน `tenders` ผู้ขายจะ select เอาไปได้ทันที (`02_rls.sql:92` = policy ให้เฉพาะ `is_buyer()`)
- **เขียน `bids` ตรง ๆ ไม่ได้** — ไม่มี policy insert/update/delete โดยตั้งใจ (`02_rls.sql:128`) ทุกการยื่นราคาต้องผ่าน `submit_bid()` และ **ยอดรวมคำนวณจาก `qty` ในฐานข้อมูล ไม่รับยอดจาก client** (`03_functions.sql:162`)
- **ประมูลปิด (sealed) = ซ่อนราคา ไม่ใช่ยื่นได้ครั้งเดียว** — ยื่นกี่ครั้งก็ได้จนหมดเวลา ระบบบอกแค่ว่า "ถึงราคาคาดหวังหรือยัง" ผ่านสัญลักษณ์ค้อน (`hammer`) โดยไม่เปิดตัวเลข
- **เอกสารแนบหลังปิดประมูล 3 วัน** (`format.js:39` `DOCS_GRACE_DAYS = 3`) ระหว่างประมูลห้ามแนบไฟล์ เพื่อให้แข่งกันที่ราคาอย่างเดียว
- **เห็นราคาคู่แข่งเมื่อไหร่**: `canSeePrices = type === 'open' || unsealed_at != null` (`format.js:36`) — ตัวเลขที่ยังไม่ควรเห็น **ต้องไม่ render ลง DOM** (ห้ามใช้ CSS blur)
- **ผู้ขายไม่มีฟีดความเคลื่อนไหว** — กระดานราคาปิดชื่อคู่แข่งเป็น "ผู้เสนอราคา A/B/C"
  แต่ฟีดเคยประกาศชื่อบริษัทจริงคู่กับราคา เอามาเทียบกันแล้วเฉลยได้หมด
  จึงตัดเมนูและการ์ดฟีดออกจากฝั่งผู้ขาย และตั้ง `buyer_only = true` ให้เหตุการณ์
  `bid` / `rebid` / `award` ที่ต้นทาง (`20_hide_bid_events.sql`) ไม่ใช่ซ่อนแค่หน้าจอ
- **เปลี่ยนรหัสผ่านผ่าน RPC `change_my_password` ไม่ใช่ `auth.updateUser`** (ดูหัวข้อทางที่ตันด้านล่าง)
- UI ไม่มี router — สลับหน้าด้วย state ใน `App.jsx` · ธีมใช้ CSS custom properties รองรับ dark mode 3 สถานะ

---

## ทางที่ตันแล้ว — อย่าลองซ้ำ (Failed approaches)

1. **`supabase.auth.updateUser({ password })` ค้างไม่ตอบกลับ** (ครบ 12 วิ timeout ทุกครั้ง) แก้ด้วยการเขียนรหัสผ่านผ่าน SQL แทน → `09_self_password.sql` + `api.js:29` อย่าย้ายกลับไปใช้ `updateUser`
2. **เรียกฟังก์ชัน auth ซ้อนใน `onAuthStateChange` = deadlock** ของ GoTrue lock — ต้องเลื่อนออกด้วย `setTimeout(..., 0)` (`App.jsx:40`) อาการคือหน้าค้างเงียบ ๆ ไม่มี error
3. **สร้าง Supabase client หลายตัว** (HMR ทำให้เกิดซ้ำ) แย่ง navigator LockManager กัน — ต้องเก็บ singleton ไว้บน `globalThis` (`supabase.js:17`) และ client สำหรับ verify ต้องใช้ `storageKey` คนละอัน (`supabase.js:32`)
4. **อีเมลของ Supabase ใช้ไม่ได้** — ปุ่ม "ลืมรหัสผ่าน" ขึ้น HTTP 504 และปุ่ม Reset password ใน Dashboard เคยทำให้**ทุกคนเข้าระบบไม่ได้ทั้งระบบ** จนกว่าจะต่อ Custom SMTP ห้ามกดปุ่มใด ๆ ใน Supabase ที่ทำงานผ่านอีเมล ใช้ `06_reset_password.sql` (รายคน), `08_emergency_access.sql` (ทุกคน) หรือปุ่มตั้งรหัสในหน้า "ผู้ใช้และผู้ขาย" แทน
5. **Cloudflare Workers + wrangler ดีพลอยไม่ผ่าน** (มันไป auto-detect ว่าเป็น Vite framework แล้วล้ม) — ใช้ **Pages** เท่านั้น และ framework preset ต้องเป็น **None**
6. **ซ่อนตัวเลขด้วย CSS blur** ไม่ใช่การซ่อน — ค่ายังอยู่ใน DOM เปิด DevTools อ่านได้ ต้องไม่ render (ใช้ `฿ ——`)
7. **`throw` ตอนโหลดโมดูลเมื่อ env var หาย** → หน้าขาวไม่มีข้อความ ใช้หน้าจอ `ConfigError` แทน (`main.jsx:8`)
8. **ทางลัด "ยืนยันเฉพาะที่อยู่ผู้ส่ง" ใช้ไม่ได้กับโดเมนนี้** — Brevo ปฏิเสธตอนกด Add sender
   ด้วยข้อความ *"Your DMARC policy requires your domain to be authenticated"* เพราะ
   `_dmarc.cjmart.co.th` ตั้ง `p=quarantine` ผู้ให้บริการยุคนี้จึงไม่ยอมส่งแทนโดเมนที่ยังไม่ยืนยัน
   → **ไม่มีทางลัด** ถ้าจะส่งในนาม `@cjmart.co.th` ต้องให้ IT เพิ่ม DNS เท่านั้น
   และ **ห้ามแก้ DMARC เป็น `p=none` เพื่อให้ผ่าน** เพราะเปิดช่องให้คนปลอมอีเมลทั้งบริษัท

---

## กับดักที่ต้องระวัง (Known traps)

- **ลำดับการดีพลอยสำคัญ**: push โค้ด → **รอ Cloudflare build เสร็จ** → ค่อยรัน SQL ที่ลบคอลัมน์ ถ้ารัน SQL ก่อน เว็บเวอร์ชันเก่าจะขอคอลัมน์ที่ถูกลบ แล้ว**รายการประมูลหายทั้งหน้า** (ข้อมูลไม่หาย แค่หน้าเว็บพัง)
- **คอลัมน์ที่เพิ่มทีหลังต้องทนได้ทั้งสองสถานะ** — เว็บกับฐานข้อมูลอัปเดตคนละจังหวะเสมอ
  ถ้า `select` ขอคอลัมน์ที่ฐานข้อมูลยังไม่มี PostgREST จะ error ทั้ง query แล้วทั้งหน้าพัง
  ตัวอย่างที่เจอจริง: `column tenders.remark does not exist` → `api.js` จึงถอยไปขอแบบไม่มีคอลัมน์นั้น
  (ดู `selectTender()` / `hasRemark`) เวลาเพิ่มคอลัมน์ใหม่ให้ทำแบบเดียวกัน
- **`00_all_in_one.sql` ลบทุกตารางก่อนสร้างใหม่** — ใช้ได้เฉพาะตอนติดตั้งครั้งแรกเท่านั้น ห้ามรันหลังเริ่มใช้งานจริง
- **ไฟล์ `05`–`13` ไม่ได้รวมอยู่ใน all-in-one** ลืมรันไฟล์ใดไฟล์หนึ่งแล้วระบบจะดูปกติ แต่พังตอนใช้งานจริง เคยเกิดจริง 2 ครั้ง:
  - ลืม `10_manage_tender.sql` → กดยื่นราคาขึ้น `record "v_t" has no field "cancelled_at"`
  - ลืม `11_link_users.sql` → บัญชีที่สร้างใหม่ไม่โผล่ในหน้า "ผู้ใช้และผู้ขาย"
  - **วิธีเช็ค**: รัน `13_verify_install.sql` (อ่านอย่างเดียว) จะได้ตาราง ❌/✅ พร้อมชื่อไฟล์ที่ต้องรัน
- **`git add . && git commit -m "x" && git push`** — ถ้าไม่มีอะไรให้ commit คำสั่ง commit จะจบด้วยสถานะล้มเหลว แล้ว `&&` จะ**ตัด push ทิ้งเงียบ ๆ** ใช้ `;` คั่นแทน
- **ตัวแปร `VITE_*` ถูกฝังตอน build** ไม่ได้อ่านตอนรัน — แก้ค่าใน Cloudflare แล้วต้องสั่ง build ใหม่เสมอ
- **ข้อจำกัดที่ตั้งใจใส่ อย่าเผลอ "แก้"**: ฝ่ายจัดซื้อตั้งรหัสให้ฝ่ายจัดซื้อด้วยกันไม่ได้ · ถอนการผูกบัญชีที่เคยยื่นราคาแล้วไม่ได้ · ถอนบัญชีตัวเองไม่ได้ · ลบประกาศที่มีคนยื่นราคาแล้วไม่ได้ (ให้ใช้ "ยกเลิก" ที่เก็บหลักฐานไว้)
- Realtime เปิดไว้เฉพาะตาราง `bids` และ `tender_events` เท่านั้น
- **`00_all_in_one.sql` ที่รันซ้ำ = ทุกบัญชีเด้งออกพร้อมกัน** (ตาราง `profiles` ถูก drop)
  บัญชีใน Authentication ไม่หายเพราะอยู่คนละที่ · กู้ด้วย `18_rebuild_profiles.sql`
  ซึ่งสร้าง profiles กลับจากร่องรอย (`tenders.created_by` = จัดซื้อ, `bids.created_by` = ผู้ขาย)
  แล้วต้องรัน `07`, `09`, `10`, `11`, `13`–`17` ใหม่ทั้งหมดด้วย เช็กด้วย `13_verify_install.sql`
- **บัญชีฝ่ายจัดซื้อหลุดสิทธิ์ได้จาก 2 ทางเท่านั้น** — `admin_link_user()` (ผูกทับด้วย role ผู้ขาย)
  และ `admin_unlink_user()` (ลบแถวใน `profiles` ทิ้ง) · `05_seed.sql` ก็เขียนทับ role ได้ถ้ารันซ้ำ
  · กู้คืนด้วย `17_restore_buyer.sql` ซึ่งรายงานประวัติจาก `admin_actions` ให้ด้วยว่าใครทำเมื่อไหร่

---

## ขั้นตอนถัดไป (Next steps)

1. รัน `13_verify_install.sql` ใน Supabase → SQL Editor ยืนยันว่าไม่มีอะไรขาด (ควรได้ ✅ ทั้งหมด รวมบรรทัดที่ยืนยันว่า `tenders.budget` ต้องไม่มี)
   **`[?]` ไฟล์นี้เพิ่งเขียนและยังไม่เคยรันจริง** — เป็น select อย่างเดียว ไม่แก้ข้อมูล ถ้า syntax พังให้แก้ที่ตัวไฟล์ได้เลย ไม่กระทบระบบ
2. **อีเมลออก** — เลือก Resend แล้ว มีสคริปต์ต้นแบบที่ `app/scripts/send-test-email.mjs` (ส่งได้จริงแล้วผ่าน `onboarding@resend.dev` ถึงอีเมลเจ้าของบัญชี) ที่ค้างอยู่คือ:
   - IT เพิ่ม DNS records ของ Resend (MX + TXT ใต้ `send.cjmart.co.th` และ DKIM) — **ไม่ต้องแก้ SPF เดิมของโดเมนหลักที่เป็น `-all`**
   - กลุ่ม `noreply.snp@cjmart.co.th` (mail-enabled security group) สร้างแล้ว 7 Sep 2026 — ต้องเปิดรับอีเมลจากภายนอก (`RequireSenderAuthenticationEnabled $false`) เพื่อรับการตอบกลับและอีเมลตีกลับ
   - ทางชั่วคราวระหว่างรอ DNS: ขอสิทธิ์ **Send As** บนกลุ่มให้ผู้ใช้ฝ่ายจัดซื้อ แล้วส่งจาก Outlook ด้วยไฟล์ `.eml`
     ที่สคริปต์สร้าง (`send-test-email.mjs ... --eml`) — ได้อีเมลจริงในนามบริษัทที่ผ่าน DMARC เพราะออกจาก M365 เอง
     ต้องให้ผู้มีสิทธิ์ Exchange admin ทำ (`Add-RecipientPermission` หรือ Exchange admin center → Groups → Delegation)
   - เสร็จแล้วตั้ง Supabase → Authentication → SMTP: `smtp.resend.com:587`, user `resend`, pass = API key, sender = `noreply.snp@cjmart.co.th` → ปุ่ม "ลืมรหัสผ่าน" จะใช้งานได้
3. รัน `14_open_period.sql` + `15_open_visibility.sql` + `16_remark.sql` ใน Supabase — ทำให้ `create_tender()` รับเวลา "เปิดรับราคา" จากหน้าเว็บ
   (คอลัมน์ `tenders.opens_at` มีอยู่แล้ว ก่อนหน้านี้ทุกงานจึงเปิดทันทีเสมอ) **หน้าเว็บใหม่ส่งค่านี้มาแล้ว
   ถ้ายังไม่รัน SQL งานที่สร้างจะเปิดรับทันทีโดยไม่สนเวลาที่กรอก — ไม่ error แต่ผิดจากที่ตั้งใจ**
   ส่วน `15` ตัดเงื่อนไข `opens_at <= now()` ออกจาก `can_see_tender()` ไม่งั้น**ผู้ขายจะมองไม่เห็น
   ประกาศเลยจนกว่าจะถึงเวลาเปิด** ซึ่งทำให้การตั้งเวลาล่วงหน้าไร้ประโยชน์
4. ตั้ง **custom domain** (แผนเดิมคือ `bidding.cjmart.co.th`) ที่ Cloudflare Pages ก่อนเชิญผู้ขายจริง
5. ตรวจว่า**งานตัวอย่างจาก `05_seed.sql` ถูกลบออกจาก production แล้ว** ก่อนเปิดใช้จริง (ใช้ปุ่มลบในหน้ารายละเอียดประกาศ — ลบได้เพราะยังไม่มีใครยื่นราคา)
6. ทดสอบ RLS ก่อนเปิดใช้จริง: ล็อกอินเป็นผู้ขาย A แล้วยิง REST ตรง ๆ ต้องไม่เห็นราคาของผู้ขาย B ในงานแบบปิด และต้องไม่เห็น `tender_internal` เลย (เช็กลิสต์อยู่ใน `deploy-guide.html`)

---

## คำถามค้าง (Open questions)

- ~~ชื่อโปรเจกต์ / URL ของ Cloudflare Pages~~ — ยืนยันแล้ว: `https://cjx-ebidding.pages.dev` (ตอบ 200 และเสิร์ฟ `/cjx-logo.png` ได้)
- repo บน GitHub เป็น public หรือ private? ถ้า public ให้ตรวจซ้ำว่าไม่มีคีย์ใด ๆ ถูก commit (ตอนนี้ `.env` ถูก ignore แล้ว)
- **Supabase แพ็กเกจฟรีไม่มีการสำรองข้อมูลเลย** (ยืนยันจากเอกสารทางการ: Pro ขึ้นไปถึงจะมี daily backup
  และอัปเกรดทีหลังก็ไม่ได้ backup ย้อนหลัง) ข้อมูลที่หายจึงหายถาวร
  → ใช้ `app/scripts/backup-db.sh` สำรองเองอย่างน้อยสัปดาห์ละครั้ง หรืออัปเกรดเป็น Pro ก่อนเปิดใช้จริง

---

## เอกสารอ่านต่อ

- `app/README.md` — กฎของระบบ, ผังไฟล์, "จะแก้อะไรไปที่ไฟล์ไหน"
- `deploy-guide.html` — คู่มือขึ้นระบบ 11 ขั้น + ตารางแก้ปัญหาที่เคยเจอทั้งหมด (เปิดด้วยเบราว์เซอร์)
- `demo.html` — ตัวอย่างระบบแบบกดเล่นได้ ใช้ข้อมูลจำลอง ไม่ต่อฐานข้อมูล เหมาะสำหรับอธิบายให้ผู้ใช้ใหม่
- `invite-emails.html` — ร่างอีเมลเปิดบัญชี / เชิญประมูล

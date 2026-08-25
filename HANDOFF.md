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
- `[V]` โครงไฟล์: `app/src/` 16 ไฟล์ (~1,900 บรรทัด) · `app/supabase/` 14 ไฟล์ SQL (~2,500 บรรทัด)
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

---

## กับดักที่ต้องระวัง (Known traps)

- **ลำดับการดีพลอยสำคัญ**: push โค้ด → **รอ Cloudflare build เสร็จ** → ค่อยรัน SQL ที่ลบคอลัมน์ ถ้ารัน SQL ก่อน เว็บเวอร์ชันเก่าจะขอคอลัมน์ที่ถูกลบ แล้ว**รายการประมูลหายทั้งหน้า** (ข้อมูลไม่หาย แค่หน้าเว็บพัง)
- **`00_all_in_one.sql` ลบทุกตารางก่อนสร้างใหม่** — ใช้ได้เฉพาะตอนติดตั้งครั้งแรกเท่านั้น ห้ามรันหลังเริ่มใช้งานจริง
- **ไฟล์ `05`–`13` ไม่ได้รวมอยู่ใน all-in-one** ลืมรันไฟล์ใดไฟล์หนึ่งแล้วระบบจะดูปกติ แต่พังตอนใช้งานจริง เคยเกิดจริง 2 ครั้ง:
  - ลืม `10_manage_tender.sql` → กดยื่นราคาขึ้น `record "v_t" has no field "cancelled_at"`
  - ลืม `11_link_users.sql` → บัญชีที่สร้างใหม่ไม่โผล่ในหน้า "ผู้ใช้และผู้ขาย"
  - **วิธีเช็ค**: รัน `13_verify_install.sql` (อ่านอย่างเดียว) จะได้ตาราง ❌/✅ พร้อมชื่อไฟล์ที่ต้องรัน
- **`git add . && git commit -m "x" && git push`** — ถ้าไม่มีอะไรให้ commit คำสั่ง commit จะจบด้วยสถานะล้มเหลว แล้ว `&&` จะ**ตัด push ทิ้งเงียบ ๆ** ใช้ `;` คั่นแทน
- **ตัวแปร `VITE_*` ถูกฝังตอน build** ไม่ได้อ่านตอนรัน — แก้ค่าใน Cloudflare แล้วต้องสั่ง build ใหม่เสมอ
- **ข้อจำกัดที่ตั้งใจใส่ อย่าเผลอ "แก้"**: ฝ่ายจัดซื้อตั้งรหัสให้ฝ่ายจัดซื้อด้วยกันไม่ได้ · ถอนการผูกบัญชีที่เคยยื่นราคาแล้วไม่ได้ · ถอนบัญชีตัวเองไม่ได้ · ลบประกาศที่มีคนยื่นราคาแล้วไม่ได้ (ให้ใช้ "ยกเลิก" ที่เก็บหลักฐานไว้)
- Realtime เปิดไว้เฉพาะตาราง `bids` และ `tender_events` เท่านั้น

---

## ขั้นตอนถัดไป (Next steps)

1. รัน `13_verify_install.sql` ใน Supabase → SQL Editor ยืนยันว่าไม่มีอะไรขาด (ควรได้ ✅ ทั้งหมด รวมบรรทัดที่ยืนยันว่า `tenders.budget` ต้องไม่มี)
   **`[?]` ไฟล์นี้เพิ่งเขียนและยังไม่เคยรันจริง** — เป็น select อย่างเดียว ไม่แก้ข้อมูล ถ้า syntax พังให้แก้ที่ตัวไฟล์ได้เลย ไม่กระทบระบบ
2. ต่อ **Custom SMTP** (Brevo หรือ Resend) ใน Supabase → Authentication → Emails เพื่อให้ปุ่ม "ลืมรหัสผ่าน" ใช้งานได้จริง — ต้องให้ IT เพิ่ม SPF/DKIM/DMARC ของโดเมนที่ใช้ส่ง
3. ตั้ง **custom domain** (แผนเดิมคือ `bidding.cjmart.co.th`) ที่ Cloudflare Pages ก่อนเชิญผู้ขายจริง
4. ตรวจว่า**งานตัวอย่างจาก `05_seed.sql` ถูกลบออกจาก production แล้ว** ก่อนเปิดใช้จริง (ใช้ปุ่มลบในหน้ารายละเอียดประกาศ — ลบได้เพราะยังไม่มีใครยื่นราคา)
5. ทดสอบ RLS ก่อนเปิดใช้จริง: ล็อกอินเป็นผู้ขาย A แล้วยิง REST ตรง ๆ ต้องไม่เห็นราคาของผู้ขาย B ในงานแบบปิด และต้องไม่เห็น `tender_internal` เลย (เช็กลิสต์อยู่ใน `deploy-guide.html`)

---

## คำถามค้าง (Open questions)

- ชื่อโปรเจกต์ / URL ของ Cloudflare Pages — เซสชันนี้ไม่เคยเห็น ต้องดูจาก dashboard ของ Neo
- repo บน GitHub เป็น public หรือ private? ถ้า public ให้ตรวจซ้ำว่าไม่มีคีย์ใด ๆ ถูก commit (ตอนนี้ `.env` ถูก ignore แล้ว)
- ยังไม่มีนโยบายสำรองข้อมูล (backup) — Supabase free tier เก็บ backup ให้จำกัด ควรตัดสินใจก่อนใช้งานจริง

---

## เอกสารอ่านต่อ

- `app/README.md` — กฎของระบบ, ผังไฟล์, "จะแก้อะไรไปที่ไฟล์ไหน"
- `deploy-guide.html` — คู่มือขึ้นระบบ 11 ขั้น + ตารางแก้ปัญหาที่เคยเจอทั้งหมด (เปิดด้วยเบราว์เซอร์)
- `demo.html` — ตัวอย่างระบบแบบกดเล่นได้ ใช้ข้อมูลจำลอง ไม่ต่อฐานข้อมูล เหมาะสำหรับอธิบายให้ผู้ใช้ใหม่
- `invite-emails.html` — ร่างอีเมลเปิดบัญชี / เชิญประมูล

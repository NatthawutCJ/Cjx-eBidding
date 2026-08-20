# ระบบประมูลจัดซื้อซัพพลายเออร์ (CJx e-Bidding)

React + Vite (frontend) · Supabase (Postgres + Auth + Storage + Realtime) · ฟรีทั้งสองส่วนในระดับการใช้งานเริ่มต้น

**กติกาการประมูล**
- ทั้งสองแบบ **หยอดราคาได้ไม่จำกัด** จนถึงเวลาปิดรับ และ **ไม่ต้องแนบเอกสารตอนหยอดราคา**
- **เปิดราคา (open)** — เห็นราคาคู่แข่งเรียลไทม์ (ชื่อถูกปิด) ค้อนมีคนเดียว ย้ายไปหาผู้เสนอต่ำสุดที่ถึงราคาคาดหวัง
- **ปิดราคา (sealed)** — ไม่มีใครเห็นราคาของกันเลย รวมถึงฝ่ายจัดซื้อ จนกดเปิดซองหลังหมดเวลา
  ผู้ขายเห็นเพียง **สถานะค้อนของตัวเอง**: `mine` ถือค้อนอยู่ / `other` ค้อนหลุดมือ (มีคนเสนอต่ำกว่าและถึงเกณฑ์) / `none` ยังไม่มีใครถึงเกณฑ์
  ผ่าน `my_hammer_state()` ซึ่งคืนแค่ 3 คำนี้ ไม่ส่งราคา ชื่อคู่แข่ง หรือตัวเลขเป้าออกไป
  จึงกดราคาลงมาจนถึงเป้าได้ ไม่ต้องล้มประมูลแล้วเปิดรอบใหม่
- **เอกสารประกอบส่งหลังปิดประมูล ให้เวลา 3 วัน** (`DOCS_GRACE_DAYS` ใน `src/lib/format.js`) ผ่าน `attach_bid_files()` พร้อมระบบ **ราคาคาดหวัง + ค้อน**
ที่ย้ายไปหาผู้เสนอราคาต่ำสุดที่ถึงเกณฑ์โดยอัตโนมัติ

---

## 1. โครงสร้างไฟล์

```
app/
├── supabase/
│   ├── 01_schema.sql      ตาราง ทั้งหมด + สถานะงาน + เปิด realtime
│   ├── 02_rls.sql         Row Level Security ← กติกาการมองเห็นราคาอยู่ที่นี่
│   ├── 03_functions.sql   RPC: submit_bid / unseal_tender / award_bid / create_tender / hammer_holder
│   ├── 04_storage.sql     bucket ไฟล์แนบ + policy ตาม path
│   └── 05_seed.sql        ข้อมูลตัวอย่าง (แก้ UUID ผู้ใช้ก่อนรัน)
├── src/
│   ├── styles.css         ธีมทั้งระบบ (สี ฟอนต์ ระยะ) — แก้ที่ :root ที่เดียว
│   ├── lib/supabase.js    สร้าง client จาก .env
│   ├── lib/format.js      รูปแบบเงิน/วันที่ + สถานะงาน + กติกาการมองเห็น (ฝั่ง UI)
│   ├── lib/api.js         ทุกการคุยกับ Supabase รวมไว้ที่นี่
│   ├── App.jsx            session + โครงหน้า (sidebar / tabbar) + หน้า ราคาของฉัน, ความเคลื่อนไหว
│   └── components/        Login, TenderList, TenderDetail, BidForm, Board, BuyerDashboard, CreateTender, bits
├── public/cjx-logo.png    โลโก้ (พื้นโปร่งใส)
├── index.html  vite.config.js  package.json  .env.example
```

---

## 2. ติดตั้งครั้งแรก

**2.1 สร้างโปรเจกต์ Supabase**
supabase.com → New project → Region **Southeast Asia (Singapore)** → ตั้ง Database Password เก็บไว้

**2.2 รัน SQL ตามลำดับ**
Dashboard → SQL Editor → วางเนื้อไฟล์แล้วกด Run ทีละไฟล์: `01_schema.sql` → `02_rls.sql` → `03_functions.sql` → `04_storage.sql`

**2.3 สร้างผู้ใช้**
Authentication → Users → Add user (ใส่อีเมล + รหัสผ่าน + ติ๊ก Auto Confirm)
สร้าง 1 บัญชีฝ่ายจัดซื้อ และ 1 บัญชีต่อ 1 ซัพพลายเออร์ แล้วคัดลอก UUID ของแต่ละคนไว้

**2.4 ใส่ข้อมูลตั้งต้น**
เปิด `05_seed.sql` แก้ UUID 4 บรรทัดบนสุดให้ตรงกับผู้ใช้ที่สร้าง แล้วรัน

**2.5 รันหน้าเว็บ**
```bash
cd app
cp .env.example .env      # ใส่ VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY จาก Project Settings > API
npm install
npm run dev               # เปิด http://localhost:5173
```

**2.6 Deploy — Cloudflare Pages (แนะนำ)**
push โค้ดขึ้น GitHub → dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
- Framework preset: `Vite`
- Root directory: `app`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

ได้เว็บที่ `ชื่อโปรเจกต์.pages.dev` พร้อม HTTPS · bandwidth ไม่จำกัด · มี edge ที่กรุงเทพ
ผูกโดเมนเองที่แท็บ Custom domains (ถ้า DNS ของ cjmart.co.th อยู่บน Cloudflare แล้วจะกดผูกได้ทันที)

*ทางเลือก — Netlify*: Add new site → Import from GitHub · Base directory `app` · Build `npm run build` · Publish `app/dist` · ใส่ env vars เหมือนกัน (ฟรี 100 GB/เดือน)

anon key ปลอดภัยที่จะฝังไปกับหน้าเว็บ เพราะทุกสิทธิ์ถูกคุมด้วย RLS ฝั่งฐานข้อมูล
**อย่าเอา service_role key มาใส่ใน frontend เด็ดขาด** — คีย์นั้นข้าม RLS ทั้งหมด

---

## 3. จะแก้อะไร ต้องไปที่ไฟล์ไหน

| อยากแก้ | ไฟล์ / ที่ตั้ง | วิธี |
|---|---|---|
| สีหลักของระบบ | `src/styles.css` | `:root { --accent: #1E40AF }` และบล็อกธีมมืดอีก 2 ที่ (ค้นหา `--accent:`) |
| ฟอนต์ | `src/styles.css` | `--font-d` / `--font-b` / `--font-m` |
| รูปแบบวันที่ / สกุลเงิน | `src/lib/format.js` | `dmy()` `baht()` — แก้ที่นี่มีผลทุกหน้า |
| รูปแบบเลขที่งาน `RFQ_2026_08_001` | `supabase/03_functions.sql` → `next_tender_code()` | แก้ `to_char(now(),'YYYY_MM')` และ `lpad(...,3,'0')` แล้วรัน `create or replace` ใหม่ |
| รายชื่อ / เพิ่มซัพพลายเออร์ | ตาราง `suppliers` | Table Editor เพิ่มแถว หรือ `insert into suppliers (code,name,tax_id) values (...)` |
| เอกสารที่ต้องแนบเป็นค่าตั้งต้น | `src/components/CreateTender.jsx` → `DEFAULT_DOCS` | แก้อาร์เรย์ |
| เปอร์เซ็นต์ปุ่มหยอดราคาเร็ว (5/10/15/20%) | `src/components/BidForm.jsx` | ค้นหา `[5, 10, 15, 20].map` |
| จำนวนวันส่งเอกสารหลังปิดประมูล | `src/lib/format.js` → `DOCS_GRACE_DAYS` | ตอนนี้ 3 วัน |
| ให้ผู้ขายรู้ว่าถึงเป้ายัง / ค้อนอยู่ที่ใคร | `supabase/03_functions.sql` → `my_target_status()`, `my_hammer_state()` | คืน boolean / 'mine' 'other' 'none' เท่านั้น |
| ขนาดไฟล์แนบสูงสุด | `supabase/04_storage.sql` (`file_size_limit`) + `src/components/BidForm.jsx` (`20 * 1048576`) | ต้องแก้ทั้งสองที่ให้ตรงกัน |
| ใครเห็นราคาเมื่อไร | `supabase/02_rls.sql` → `can_see_prices()` | จุดเดียวที่ตัดสินเรื่องนี้ทั้งระบบ |
| กติกาค้อน | `supabase/03_functions.sql` → `hammer_holder()` | ตอนนี้ = ราคาต่ำสุดที่ `total <= target_price` |
| ให้ผู้ขายเห็นตัวเลขราคาคาดหวังด้วย | `supabase/02_rls.sql` | เพิ่ม policy select บน `tender_internal` ให้ผู้ถูกเชิญ (ไม่แนะนำ — ทุกรายจะเสนอเท่าเป้าพอดี) |
| ข้อความในระบบ | อยู่ใน JSX ตรงๆ ไม่มีไฟล์แปลภาษา | ค้นหาข้อความไทยในไฟล์นั้นแล้วแก้ |

### ตัวอย่าง: เพิ่มฟิลด์ใหม่ให้ประกาศ (เช่น "ระยะเวลาส่งมอบ")
1. **DB** — `alter table tenders add column delivery_days int;`
2. **RPC** — ใน `create_tender()` เพิ่ม `delivery_days` ในคำสั่ง insert และอ่านจาก `(p->>'delivery_days')::int`
3. **API** — `src/lib/api.js` เพิ่มชื่อคอลัมน์ใน `TENDER_COLS`
4. **ฟอร์ม** — `CreateTender.jsx` เพิ่ม input และส่งค่าไปใน payload
5. **แสดงผล** — `TenderDetail.jsx` เพิ่มบรรทัดที่ต้องการ

ลำดับนี้ใช้ได้กับทุกฟิลด์ใหม่: ฐานข้อมูล → RPC → api.js → ฟอร์ม → หน้าแสดงผล

---

## 4. ทดสอบว่า RLS กันจริง (ควรทำก่อนใช้งานจริง)

ล็อกอินเป็นผู้ขายในเบราว์เซอร์ เปิด DevTools → Console แล้วรัน:

```js
// พยายามอ่านราคาคาดหวัง — ต้องได้ [] เสมอ
await window.supabase?.from('tender_internal').select('*')

// พยายามอ่านใบเสนอราคาของงานปิดซองที่ยังไม่เปิด — ต้องเห็นแค่ใบของตัวเอง
await window.supabase?.from('bids').select('supplier_id,total')
```
(ถ้าต้องการทดสอบแบบนี้ ให้เพิ่ม `window.supabase = supabase` ชั่วคราวใน `src/lib/supabase.js` แล้วลบออกก่อน deploy)

หรือยิงตรงด้วย curl โดยใช้ access token ของผู้ขาย:
```bash
curl "$SUPABASE_URL/rest/v1/tender_internal?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPPLIER_ACCESS_TOKEN"
# ต้องได้ []
```

**สิ่งที่ระบบกันไว้แล้ว**
- ผู้ขายอ่าน `tender_internal` (ราคาคาดหวัง) ไม่ได้เลย — ไม่มี policy ให้
- ไม่มีใครอ่านราคาของคนอื่นในงานปิดซองก่อนเปิดซอง รวมถึงฝ่ายจัดซื้อ
- เปิดซองก่อนเวลาปิดรับไม่ได้ — `unseal_tender()` ตรวจเวลาและบันทึกผู้กด
- ยอดรวมคำนวณจาก `qty` ในฐานข้อมูล ไม่รับยอดจาก client
- งานปิดราคาแก้ราคาได้ไม่จำกัด แต่ราคาถูกปิดผนึกที่ระดับ RLS จนเปิดซอง
- ผู้ขายเห็นเฉพาะงานที่ถูกเชิญ และไฟล์ในโฟลเดอร์ของบริษัทตัวเอง

---

## 5. สิ่งที่ยังไม่รวมในชุดนี้ (ต้องทำต่อ)

| หัวข้อ | สถานะ |
|---|---|
| ส่งอีเมลเชิญ/แจ้งเตือนจริง | ร่างข้อความอยู่ที่ `../invite-emails.html` — ของจริงต้องทำ Edge Function + ต่อ SMTP (Resend/Brevo) และให้ IT ตั้ง SPF/DKIM/DMARC |
| หน้าเพิ่ม/แก้ซัพพลายเออร์ในเว็บ | ยังต้องทำใน Table Editor |
| เชิญผู้ใช้ใหม่จากในเว็บ | ยังต้องสร้างใน Authentication > Users |
| ถาม-ตอบสเปกในประกาศ (Q&A) | ยังไม่ได้ทำ |
| Export Excel / พิมพ์ใบเปรียบเทียบ | ยังไม่ได้ทำ |
| ยกเลิกใบเสนอราคา (กรณีผู้ขายยื่นผิดในงานปิดซอง) | ยังไม่ได้ทำ ต้องเพิ่ม RPC ให้ฝ่ายจัดซื้อลบใบเดิม |
| PWA (ติดตั้งเป็นไอคอนบนมือถือ) | ยังไม่ได้ทำ ต้องเพิ่ม manifest + service worker |

## 6. หมายเหตุ

โค้ดชุดนี้ผ่านการตรวจ syntax ทุกไฟล์ (Babel parse) และตรวจ import/export ข้ามไฟล์แล้ว
แต่ **ยังไม่ได้ `npm install` / `npm run build` จริง** เพราะเครื่องที่เขียนไม่มี Node ติดตั้ง
ตอนรันครั้งแรกถ้ามี error ให้ส่ง error มาได้เลย และควรทดสอบตามลำดับนี้:
เข้าสู่ระบบ → เห็นรายการงาน → ยื่นราคาในงานเปิดราคา → เปิดอีกเบราว์เซอร์เป็นผู้ขายรายที่สองแล้วดูว่าราคาขึ้นเรียลไทม์ →
ล็อกอินเป็นฝ่ายจัดซื้อ → เปิดซองงานปิดราคา → ประกาศผู้ชนะ

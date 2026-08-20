import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — คัดลอก .env.example เป็น .env แล้วใส่ค่าจาก Supabase')
}

// เก็บ client ไว้บน globalThis
// เหตุผล: ตอน npm run dev ทุกครั้งที่แก้ไฟล์ Vite จะโหลดโมดูลใหม่ (HMR)
// ถ้าสร้าง client ใหม่ทุกครั้ง จะมี GoTrueClient หลายตัวในหน้าเดียว แย่ง lock ของ auth กันเอง
// ผลคือคำสั่งอย่าง updateUser ค้างไม่จบ (อาการ: กดเปลี่ยนรหัสผ่านแล้วรอจนหมดเวลา)
const g = globalThis
export const supabase = g.__cjxSupabase ?? (g.__cjxSupabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cjx-bidding-auth' },
}))

// client แยกสำหรับ "ตรวจรหัสผ่านเดิม" เท่านั้น
//   - persistSession: false  → ไม่แตะ session ที่ล็อกอินอยู่
//   - storageKey ต่างกัน     → ไม่แย่ง lock กับ client หลัก
// จึงตรวจรหัสเดิมได้โดยไม่ทำให้ client หลักค้างและไม่ทำให้หลุดล็อกอิน
export const verifyClient = () => createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'cjx-verify-only',
  },
})

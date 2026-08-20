import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// ไม่ throw ตรงนี้ เพราะการ throw ตอนโหลดโมดูลทำให้เว็บขึ้นหน้าขาวโดยไม่บอกสาเหตุ
// ให้ main.jsx อ่านค่านี้ไปแสดงข้อความบนหน้าจอแทน
export const configError = (!url || !key)
  ? `ยังไม่ได้ตั้งค่า ${[!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean).join(' และ ')}`
  : null

// เก็บ client ไว้บน globalThis
// เหตุผล: ตอน npm run dev ทุกครั้งที่แก้ไฟล์ Vite จะโหลดโมดูลใหม่ (HMR)
// ถ้าสร้าง client ใหม่ทุกครั้ง จะมี GoTrueClient หลายตัวในหน้าเดียว แย่ง lock ของ auth กันเอง
// ผลคือคำสั่งอย่าง updateUser ค้างไม่จบ (อาการ: กดเปลี่ยนรหัสผ่านแล้วรอจนหมดเวลา)
const g = globalThis
export const supabase = configError ? null
  : (g.__cjxSupabase ?? (g.__cjxSupabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cjx-bidding-auth' },
    })))

// client แยก เผื่อต้องตรวจรหัสผ่านผ่าน Auth API ในอนาคต
// (ตอนนี้การเปลี่ยนรหัสใช้ฟังก์ชันในฐานข้อมูลแทน จึงไม่ได้เรียกใช้)
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

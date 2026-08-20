// ---------- รูปแบบตัวเลข / วันที่ ----------
// วันที่ใช้รูปแบบ "1 Aug 26" ตามที่ตกลงไว้ — แก้ที่นี่ที่เดียวถ้าจะเปลี่ยนทั้งระบบ
export const MIN = 60000, HOUR = 3600000, DAY = 86400000

export const baht  = n => '฿' + Math.round(Number(n) || 0).toLocaleString('th-TH')
export const baht2 = n => '฿' + (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const num   = n => (Number(n) || 0).toLocaleString('th-TH')
export const kb    = s => (s >= 1048576 ? (s / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((s || 0) / 1024)) + ' KB')
export const ext   = n => (String(n).split('.').pop() || 'file').slice(0, 4)

export const clock = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const dmy   = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
export const stamp = ts => dmy(ts) + ' ' + clock(ts)
export const sameDay = ts => new Date(ts).toDateString() === new Date().toDateString()
export const when  = ts => (sameDay(ts) ? clock(ts) : stamp(ts))

export function cdText(ms) {
  if (ms <= 0) return 'ปิดรับแล้ว'
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR)
  const m = Math.floor((ms % HOUR) / MIN), s = Math.floor((ms % MIN) / 1000)
  const p = n => String(n).padStart(2, '0')
  return d > 0 ? `${d} วัน ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`
}

// ---------- สถานะงาน / กติกาการมองเห็น (ต้องตรงกับ RLS ฝั่ง Postgres) ----------
export const statusOf = t =>
  t.awarded_bid_id ? 'awarded'
  : Date.now() > new Date(t.closes_at).getTime() ? 'closed'
  : Date.now() < new Date(t.opens_at).getTime() ? 'scheduled' : 'live'

export const closingSoon = t => statusOf(t) === 'live' && new Date(t.closes_at) - Date.now() < 60 * MIN
export const canSeePrices = t => t.type === 'open' || !!t.unsealed_at

// ส่งเอกสารประกอบได้ภายใน 3 วันหลังปิดรับราคา (ทั้งงานปิดและเปิด) — แก้ตัวเลขนี้ที่เดียว
export const DOCS_GRACE_DAYS = 3
export const docsDueAt = t => new Date(t.closes_at).getTime() + DOCS_GRACE_DAYS * DAY
export const bidTotal = b => Number(b.total) || 0

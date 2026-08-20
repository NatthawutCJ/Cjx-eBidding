import { useEffect, useState } from 'react'
import { cdText, dmy, stamp, ext, kb, statusOf, closingSoon, canSeePrices, MIN } from '../lib/format'
import { fileUrl } from '../lib/api'

// ---------------- ไอคอน ----------------
const svg = (d, extra = {}) => (
  <svg viewBox="0 0 24 24" {...extra}>{d}</svg>
)
export const ICON = {
  gavel: svg(<><path d="M3.5 20.5h9" /><path d="M13.8 3.2l7 7" /><path d="M9.6 7.4l7 7" />
    <path d="M8.1 5.1l3.1-1.9 5 5-1.9 3.1z" /><path d="M11.2 10.5L5 16.7" /></>,
    { strokeLinecap: 'round', strokeLinejoin: 'round' }),
  list: svg(<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeLinecap="round" />),
  tag: svg(<><path d="M20.5 13.5L13 21a2 2 0 01-2.8 0l-7-7V4.5A1.5 1.5 0 014.7 3h9.6l6.2 6.2a2 2 0 010 2.8z" /><circle cx="8" cy="8" r="1.2" /></>),
  bolt: svg(<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z" strokeLinejoin="round" />),
  chart: svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />),
  plus: svg(<path d="M12 5v14M5 12h14" strokeLinecap="round" />),
  lock: svg(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></>, { strokeWidth: 2 }),
  eye: svg(<><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></>, { strokeWidth: 2 }),
  check: svg(<path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" />),
  circle: svg(<circle cx="12" cy="12" r="8" />),
  back: svg(<path d="M15 5l-7 7 7 7" strokeLinecap="round" />, { strokeWidth: 2 }),
}

// ---------------- toast ----------------
let listeners = []
let seq = 0
export function toast(title, text, kind) {
  const item = { id: ++seq, title, text, kind }
  listeners.forEach(fn => fn(item))
}
export function Toasts() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const fn = item => {
      setItems(v => [...v, item])
      setTimeout(() => setItems(v => v.filter(x => x.id !== item.id)), 5200)
    }
    listeners.push(fn)
    return () => { listeners = listeners.filter(f => f !== fn) }
  }, [])
  return (
    <div id="toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={'toast ' + (t.kind || '')}>
          <b>{t.title}</b><span className="muted">{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------- chips ----------------
export const TypeChip = ({ t }) => t.type === 'sealed'
  ? <span className="chip sealed">{ICON.lock}ปิดราคา</span>
  : <span className="chip open">{ICON.eye}เปิดราคา</span>

export function StatusChip({ t }) {
  const st = statusOf(t)
  if (st === 'awarded') return <span className="chip flat">ประกาศผลแล้ว</span>
  if (st === 'closed') return t.type === 'sealed' && !t.unsealed_at
    ? <span className="chip warn">รอเปิดซอง</span>
    : <span className="chip flat">ปิดรับราคา</span>
  if (st === 'scheduled') return <span className="chip flat">ยังไม่เปิดรับ</span>
  if (closingSoon(t)) return <span className="chip warn"><i className="dot pulse" />ใกล้หมดเวลา</span>
  return <span className="chip live"><i className="dot pulse" />กำลังประมูล</span>
}

export const HammerChip = ({ mine }) =>
  <span className="chip hammer">{ICON.gavel}{mine ? 'ค้อนของคุณ' : 'ค้อน'}</span>

// ---------------- นับเวลาถอยหลัง ----------------
export function Countdown({ t, className = '' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(v => v + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (statusOf(t) === 'awarded') return <span className={'cd over ' + className}>ประกาศผลแล้ว</span>
  const ms = new Date(t.closes_at) - Date.now()
  const cls = ms <= 0 ? 'over' : ms < 60 * MIN ? 'soon' : ''
  return <span className={`cd ${cls} ${className}`}>{cdText(ms)}</span>
}

// ---------------- เอกสารแนบ ----------------
export function DocList({ files, bucket, empty = 'ยังไม่มีเอกสารแนบ' }) {
  if (!files || !files.length) return <p className="dim">{empty}</p>
  const open = async f => {
    try { window.open(await fileUrl(bucket, f.file_path), '_blank', 'noopener') }
    catch (e) { toast('เปิดไฟล์ไม่ได้', e.message, 'crit') }
  }
  return (
    <div className="docs">
      {files.map(f => (
        <div className="doc" key={f.id || f.file_path}>
          <span className="ext">{ext(f.file_name)}</span>
          <span className="n">{f.file_name}</span>
          <span className="dim num">{kb(f.size_bytes)}</span>
          <button type="button" className="btn ghost sm" onClick={() => open(f)}>เปิด</button>
        </div>
      ))}
    </div>
  )
}

export const Req = ({ ok, children }) =>
  <span className={'req ' + (ok ? 'ok' : 'no')}>{ok ? ICON.check : ICON.circle}<span>{children}</span></span>

export { dmy, stamp, canSeePrices }

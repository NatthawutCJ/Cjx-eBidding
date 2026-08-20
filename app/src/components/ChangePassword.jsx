import { useState } from 'react'
import { changePassword, setNewPassword, signOut } from '../lib/api'
import { toast } from './bits'

const RULES = [
  { test: v => v.length >= 8, label: 'ยาวอย่างน้อย 8 ตัวอักษร' },
  { test: v => /[a-zA-Z]/.test(v), label: 'มีตัวอักษรภาษาอังกฤษ' },
  { test: v => /\d/.test(v), label: 'มีตัวเลข' },
]

/**
 * ใช้ได้ 3 โหมด
 *   forced   — ครั้งแรกที่เข้าใช้งาน (รหัสที่ฝ่ายจัดซื้อตั้งให้) เปลี่ยนก่อนจึงใช้งานได้
 *   recovery — มาจากลิงก์ในอีเมล ไม่ต้องกรอกรหัสเดิม
 *   sheet    — เปลี่ยนเองเมื่อไรก็ได้ จากเมนูในระบบ
 */
export default function ChangePassword({ mode = 'sheet', profile, onDone, onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const recovery = mode === 'recovery'
  const forced = mode === 'forced'

  const passed = RULES.map(r => r.test(next))
  const ready = passed.every(Boolean) && next === confirm && (recovery || current.length > 0)

  async function submit(e) {
    e.preventDefault()
    if (next !== confirm) return toast('รหัสผ่านไม่ตรงกัน', 'กรอกรหัสใหม่ให้ตรงกันทั้งสองช่อง', 'crit')
    setBusy(true)
    try {
      if (recovery) await setNewPassword(next)
      else await changePassword(profile.email, current, next)
      toast('เปลี่ยนรหัสผ่านแล้ว', 'ครั้งต่อไปให้เข้าสู่ระบบด้วยรหัสใหม่', 'good')
      onDone?.()
    } catch (err) {
      toast('เปลี่ยนรหัสผ่านไม่สำเร็จ', err.message, 'crit')
    } finally { setBusy(false) }
  }

  const form = (
    <form className="card" onSubmit={submit}>
      <header><h3>{forced ? 'ตั้งรหัสผ่านของคุณเอง' : recovery ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่าน'}</h3></header>
      <div className="body stack">
        {forced && (
          <div className="note-forced rule">
            <b>ก่อนเริ่มใช้งาน กรุณาเปลี่ยนรหัสผ่าน</b> — รหัสที่ท่านได้รับมาเป็นรหัสที่ฝ่ายจัดซื้อตั้งให้
            ซึ่งฝ่ายจัดซื้อรู้ด้วย ถ้าไม่เปลี่ยน จะมีคนอื่นเข้าระบบและยื่นราคาในนามบริษัทของท่านได้
          </div>
        )}

        {!recovery && (
          <label className="f"><span>รหัสผ่านเดิม (ที่ได้รับมา)</span>
            <input type="password" autoComplete="current-password" required value={current}
                   onChange={e => setCurrent(e.target.value)} /></label>
        )}

        <label className="f"><span>รหัสผ่านใหม่</span>
          <input type="password" autoComplete="new-password" required value={next}
                 onChange={e => setNext(e.target.value)} /></label>

        <div className="stack" style={{ gap: '.25rem' }}>
          {RULES.map((r, i) => (
            <span key={i} className={'req ' + (passed[i] ? 'ok' : 'no')} style={{ fontSize: '.82rem' }}>
              <svg viewBox="0 0 24 24">{passed[i]
                ? <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" />
                : <circle cx="12" cy="12" r="8" />}</svg>
              <span>{r.label}</span>
            </span>
          ))}
        </div>

        <label className="f"><span>ยืนยันรหัสผ่านใหม่</span>
          <input type="password" autoComplete="new-password" required value={confirm}
                 onChange={e => setConfirm(e.target.value)} />
          {confirm.length > 0 && next !== confirm &&
            <span className="dim" style={{ color: 'var(--crit)' }}>ยังไม่ตรงกับรหัสใหม่</span>}
        </label>
      </div>
      <footer style={{ padding: '.75rem 1rem', borderTop: '1px solid var(--line)', display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
        {!forced && !recovery && <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>}
        {forced && <button type="button" className="btn" onClick={() => signOut()}>ออกจากระบบ</button>}
        <button className="btn primary" type="submit" disabled={busy || !ready}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
        </button>
      </footer>
    </form>
  )

  // โหมดบังคับ / มาจากลิงก์อีเมล = เต็มหน้า ไม่มีทางข้าม
  if (forced || recovery) {
    return (
      <div className="login">
        <div className="loginbox">
          <div className="row" style={{ gap: '.7rem' }}>
            <img className="logo" src="/cjx-logo.png" alt="CJx" style={{ height: 52 }} />
            <span><b style={{ fontFamily: 'var(--font-d)', fontSize: '1rem', display: 'block' }}>ระบบประมูลจัดซื้อ</b>
              <span className="dim">{profile?.org || 'Supplier e-Bidding Portal'}</span></span>
          </div>
          {form}
        </div>
      </div>
    )
  }

  return (
    <div className="scrim" onClick={e => { if (e.target.classList.contains('scrim')) onClose() }}>
      <div className="sheet" style={{ maxWidth: 460 }}>{form}</div>
    </div>
  )
}

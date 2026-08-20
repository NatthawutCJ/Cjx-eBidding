import { useEffect, useState } from 'react'
import { adminListUsers, adminSetSupplierPassword, adminSetMustChange } from '../lib/api'
import { stamp } from '../lib/format'
import { ICON, toast } from './bits'

// รหัสชั่วคราวที่อ่านออกทางโทรศัพท์ได้ ไม่มีตัวที่สับสน (0 O 1 l I)
function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789'
  const pick = s => s[Math.floor(Math.random() * s.length)]
  const body = Array.from({ length: 6 }, () => pick(a + A)).join('')
  return `CJx-${body}-${pick(d)}${pick(d)}${pick(d)}`
}

export default function AdminUsers() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [issued, setIssued] = useState(null)   // { email, password }

  const load = () => adminListUsers().then(setRows)
    .catch(e => { setRows([]); toast('โหลดรายชื่อผู้ใช้ไม่ได้', e.message, 'crit') })
  useEffect(() => { load() }, [])

  async function reset(u) {
    const pw = tempPassword()
    setBusy(u.id)
    try {
      await adminSetSupplierPassword(u.id, pw)
      setIssued({ email: u.email, org: u.org, password: pw })
      toast('ตั้งรหัสชั่วคราวแล้ว', u.org, 'good')
      load()
    } catch (e) { toast('ตั้งรหัสไม่สำเร็จ', e.message, 'crit') }
    finally { setBusy('') }
  }

  async function toggleForce(u) {
    setBusy(u.id)
    try {
      await adminSetMustChange(u.id, !u.must_change_password)
      load()
    } catch (e) { toast('แก้สถานะไม่สำเร็จ', e.message, 'crit') }
    finally { setBusy('') }
  }

  const copy = async text => {
    try { await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว', 'นำไปส่งทาง LINE หรือโทรบอกได้เลย', 'good') }
    catch { toast('คัดลอกไม่ได้', 'ให้เลือกข้อความแล้วกด ⌘C', 'warn') }
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow stack" style={{ gap: '.2rem' }}>
          <span className="eyebrow">จัดการผู้ใช้</span>
          <h1>ผู้ใช้และผู้ขาย</h1>
          <p className="muted">ตั้งรหัสชั่วคราวให้ผู้ขายได้จากที่นี่ ไม่ต้องพึ่งอีเมล — เจ้าของบัญชีจะถูกบังคับเปลี่ยนรหัสเองตอนเข้าครั้งถัดไป</p>
        </div>
      </div>

      {issued && (
        <div className="card pad stack" style={{ borderColor: 'var(--warn)' }}>
          <div className="spread">
            <span className="eyebrow">รหัสชั่วคราวของ {issued.org}</span>
            <button className="btn ghost sm" onClick={() => setIssued(null)}>ปิด</button>
          </div>
          <div className="row" style={{ gap: '.6rem' }}>
            <b className="num" style={{ fontSize: '1.35rem', letterSpacing: '.02em' }}>{issued.password}</b>
            <button className="btn sm" onClick={() => copy(issued.password)}>คัดลอก</button>
          </div>
          <div className="rule" style={{ borderLeftColor: 'var(--warn)', background: 'var(--warn-wash)' }}>
            <b>ส่งทาง LINE หรือโทรบอก อย่าส่งทางอีเมลฉบับเดียวกับลิงก์เข้าระบบ</b><br />
            หน้านี้จะไม่แสดงรหัสนี้อีกหลังปิด (ระบบเก็บเฉพาะค่าที่เข้ารหัสไว้) ถ้าลืมให้กดตั้งใหม่
          </div>
        </div>
      )}

      <div className="card">
        <header><h3>บัญชีทั้งหมด</h3>
          {rows && <span className="chip flat">{rows.length} บัญชี</span>}</header>
        <div className="tlist">
          {rows === null && <div style={{ padding: '1rem' }} className="dim">กำลังโหลด…</div>}
          {rows?.length === 0 && <div style={{ padding: '1rem' }} className="dim">ยังไม่มีบัญชี</div>}
          {rows?.map(u => (
            <div className="titem" key={u.id} style={{ cursor: 'default' }}>
              <span className={'stripe ' + (u.role === 'buyer' ? 'awarded' : u.must_change_password ? 'soon' : 'live')} />
              <span className="t">
                <span className="row" style={{ gap: '.4rem' }}>
                  <span className={'chip ' + (u.role === 'buyer' ? 'open' : 'flat')}>
                    {u.role === 'buyer' ? 'ฝ่ายจัดซื้อ' : 'ซัพพลายเออร์'}</span>
                  {u.must_change_password
                    ? <span className="chip warn">{ICON.lock}ต้องเปลี่ยนรหัส</span>
                    : <span className="chip live">{ICON.check}ตั้งรหัสเองแล้ว</span>}
                </span>
                <b>{u.org}</b>
                <span className="dim">{u.full_name} · {u.email}
                  {u.last_sign_in_at && ` · เข้าล่าสุด ${stamp(u.last_sign_in_at)}`}</span>
              </span>
              <span className="r" style={{ alignItems: 'flex-end', gap: '.35rem' }}>
                {u.role === 'supplier' ? (
                  <>
                    <button className="btn sm primary" disabled={busy === u.id} onClick={() => reset(u)}>
                      {busy === u.id ? 'กำลังตั้ง…' : 'ตั้งรหัสใหม่'}
                    </button>
                    <button className="btn ghost sm" disabled={busy === u.id} onClick={() => toggleForce(u)}>
                      {u.must_change_password ? 'ยกเลิกการบังคับ' : 'บังคับเปลี่ยนรหัส'}
                    </button>
                  </>
                ) : <span className="dim">บัญชีผู้ดูแล — ตั้งรหัสจาก SQL เท่านั้น</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card pad stack">
        <span className="eyebrow">ทำอย่างอื่นที่ Supabase Dashboard</span>
        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--ink-2)', fontSize: '.9rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
          <li><b>เพิ่มผู้ใช้ใหม่</b> — Authentication → Users → Add user (ติ๊ก Auto Confirm) แล้วเพิ่มแถวใน <code>profiles</code></li>
          <li><b>เพิ่มบริษัทผู้ขาย</b> — Table Editor → <code>suppliers</code> → Insert row</li>
          <li><b>ตั้งรหัสบัญชีฝ่ายจัดซื้อ</b> — ใช้ไฟล์ <code>06_reset_password.sql</code> (ป้องกันไม่ให้ผู้ดูแลตั้งรหัสให้กันเอง)</li>
        </ul>
      </div>
    </div>
  )
}

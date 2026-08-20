import { useState } from 'react'
import { signIn, requestPasswordReset } from '../lib/api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  async function onForgot() {
    if (!email.trim()) return setErr('กรอกอีเมลก่อน แล้วกดลืมรหัสผ่านอีกครั้ง')
    setErr(''); setBusy(true)
    try { await requestPasswordReset(email); setSent(true) }
    catch (e) { setErr('ส่งอีเมลไม่สำเร็จ: ' + e.message) }
    finally { setBusy(false) }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { await signIn(email.trim(), password) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="loginbox" onSubmit={onSubmit}>
        <div className="row" style={{ gap: '.7rem' }}>
          <img className="logo" src="/cjx-logo.png" alt="CJx" style={{ height: 62 }} />
          <span>
            <b style={{ fontFamily: 'var(--font-d)', fontSize: '1.05rem', display: 'block', lineHeight: 1.2 }}>
              ระบบประมูลจัดซื้อ
            </b>
            <span className="dim">Supplier e-Bidding Portal</span>
          </span>
        </div>

        <div className="card pad stack">
          <div>
            <h1 style={{ fontSize: '1.2rem' }}>เข้าสู่ระบบ</h1>
            <p className="dim">ใช้อีเมลที่ได้รับคำเชิญจากฝ่ายจัดซื้อ หนึ่งบัญชีต่อหนึ่งบริษัท</p>
          </div>

          <label className="f">
            <span>อีเมล</span>
            <input type="email" autoComplete="username" required value={email}
                   onChange={e => setEmail(e.target.value)} placeholder="you@company.co.th" />
          </label>
          <label className="f">
            <span>รหัสผ่าน</span>
            <input type="password" autoComplete="current-password" required value={password}
                   onChange={e => setPassword(e.target.value)} />
          </label>

          {err && <div className="rule" style={{ borderLeftColor: 'var(--crit)', background: 'var(--crit-wash)' }}>
            <b>เข้าสู่ระบบไม่สำเร็จ</b><br />{err}
          </div>}

          {sent && <div className="rule" style={{ borderLeftColor: 'var(--good)', background: 'var(--good-wash)' }}>
            <b>ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว</b><br />ตรวจอีเมล {email} แล้วกดลิงก์ในนั้น (ตรวจกล่อง junk ด้วย)
          </div>}

          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
          <button className="btn block" type="button" onClick={onForgot} disabled={busy}>ลืมรหัสผ่าน</button>
          <p className="dim">
            ยังไม่ได้รับบัญชี ติดต่อฝ่ายจัดซื้อ procurement@cjmart.co.th
          </p>
        </div>
      </form>
    </div>
  )
}

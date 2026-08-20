import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { configError } from './lib/supabase'
import './styles.css'

// ถ้าตั้งค่าเชื่อมต่อไม่ครบ ให้ขึ้นข้อความบอกสาเหตุ ไม่ปล่อยให้เป็นหน้าขาว
function ConfigError() {
  return (
    <div className="login">
      <div className="loginbox">
        <div className="row" style={{ gap: '.7rem' }}>
          <img className="logo" src="/cjx-logo.png" alt="CJx" style={{ height: 48 }} />
          <b style={{ fontFamily: 'var(--font-d)', fontSize: '1.05rem' }}>ระบบประมูลจัดซื้อ</b>
        </div>
        <div className="card pad stack">
          <h1 style={{ fontSize: '1.15rem' }}>ยังเชื่อมต่อฐานข้อมูลไม่ได้</h1>
          <div className="rule" style={{ borderLeftColor: 'var(--crit)', background: 'var(--crit-wash)' }}>
            <b>{configError}</b>
          </div>
          <p className="muted" style={{ fontSize: '.92rem' }}>วิธีแก้ (ทำครั้งเดียว)</p>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--ink-2)', fontSize: '.9rem',
                       display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
            <li><b>บนเว็บจริง</b> — Cloudflare Pages → Settings → Environment variables →
              เพิ่ม <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_ANON_KEY</code> (สภาพแวดล้อม Production)
              แล้วกด <b>Retry deployment</b> เพราะค่าเหล่านี้ถูกฝังตอน build</li>
            <li><b>ในเครื่อง</b> — คัดลอก <code>.env.example</code> เป็น <code>.env</code> ใส่ค่าจาก
              Supabase → Project Settings → API แล้วรัน <code>npm run dev</code> ใหม่</li>
          </ol>
          <p className="dim">ค่าที่ใช้คือ Project URL และ <b>anon public</b> key — ห้ามใช้ service_role key</p>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {configError ? <ConfigError /> : <App />}
  </React.StrictMode>
)

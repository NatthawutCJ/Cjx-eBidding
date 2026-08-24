import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { getProfile, listTenders, listSuppliers, signOut } from './lib/api'
import { statusOf, statusLabel } from './lib/format'
import { downloadCSV, myBidRows } from './lib/csv'
import { ICON, Toasts, toast } from './components/bits'
import Login from './components/Login.jsx'
import TenderList from './components/TenderList.jsx'
import TenderDetail from './components/TenderDetail.jsx'
import BuyerDashboard from './components/BuyerDashboard.jsx'
import CreateTender from './components/CreateTender.jsx'
import ChangePassword from './components/ChangePassword.jsx'
import AdminUsers from './components/AdminUsers.jsx'

const NAV = {
  buyer: [['dash', 'ภาพรวม', ICON.chart], ['list', 'ประกาศประมูล', ICON.list],
          ['users', 'ผู้ใช้และผู้ขาย', ICON.tag], ['feed', 'ความเคลื่อนไหว', ICON.bolt]],
  supplier: [['list', 'ประกาศประมูล', ICON.list], ['mybids', 'ราคาของฉัน', ICON.tag], ['feed', 'ความเคลื่อนไหว', ICON.bolt]],
}

export default function App() {
  const [profile, setProfile] = useState(undefined)   // undefined = กำลังตรวจ session
  const [recovery, setRecovery] = useState(false)     // มาจากลิงก์ตั้งรหัสใหม่ในอีเมล

  const loadProfile = useCallback(async (user) => {
    try { setProfile(await getProfile(user)) }
    catch (e) { toast('โหลดข้อมูลผู้ใช้ไม่ได้', e.message, 'crit'); setProfile(null) }
  }, [])

  useEffect(() => {
    let alive = true
    loadProfile()

    // สำคัญ: ห้ามเรียกฟังก์ชันของ supabase (เช่น getUser) ตรงๆ ในคอลแบ็กนี้
    // supabase-js ถือ lock ของ auth อยู่ระหว่างประมวลผล event ถ้าเรียกซ้อนเข้าไปจะค้างทั้งคำสั่ง
    // (อาการ: กดเปลี่ยนรหัสผ่านแล้วปุ่มค้างที่ "กำลังบันทึก…") จึงต้องเลื่อนออกไปด้วย setTimeout 0
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') { setProfile(null); return }
      setTimeout(() => { if (alive) loadProfile(session?.user ?? undefined) }, 0)
    })
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [loadProfile])

  if (profile === undefined) return <><div className="login"><p className="dim">กำลังเข้าสู่ระบบ…</p></div><Toasts /></>
  if (!profile) return <><Login /><Toasts /></>

  // บัญชีที่สร้างแล้วแต่ฝ่ายจัดซื้อยังไม่ได้ผูกกับบริษัท
  if (profile.unlinked) return <><Unlinked profile={profile} /><Toasts /></>

  // ตั้งรหัสใหม่จากลิงก์อีเมล
  if (recovery) return <><ChangePassword mode="recovery" profile={profile}
    onDone={() => { setRecovery(false); loadProfile() }} /><Toasts /></>

  // รหัสที่ฝ่ายจัดซื้อตั้งให้ ต้องเปลี่ยนก่อนใช้งาน (ฝั่ง server ก็ปฏิเสธการยื่นราคาไว้ด้วย)
  if (profile.must_change_password) return <><ChangePassword mode="forced" profile={profile}
    onDone={loadProfile} /><Toasts /></>

  return <><Shell profile={profile} /><Toasts /></>
}

function Shell({ profile }) {
  const isBuyer = profile.role === 'buyer'
  const [view, setView] = useState(isBuyer ? 'dash' : 'list')
  const [tenderId, setTenderId] = useState(null)
  const [tenders, setTenders] = useState([])
  const [sheet, setSheet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState([])
  const [pwOpen, setPwOpen] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    listTenders(profile.supplier_id)
      .then(setTenders)
      .catch(e => toast('โหลดรายการไม่ได้', e.message, 'crit'))
      .finally(() => setLoading(false))
  }, [profile.supplier_id])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (isBuyer) listSuppliers().then(setSuppliers).catch(() => {}) }, [isBuyer])

  const open = id => { setTenderId(id); setView('detail'); window.scrollTo(0, 0) }
  const go = v => { setTenderId(null); setView(v); reload() }

  const items = NAV[profile.role].map(([v, label, ic]) => ({
    v, label, ic,
    cur: (view === 'detail' ? 'list' : view) === v,
    badge: v === 'list' ? tenders.filter(t => statusOf(t) === 'live').length : null,
  }))

  const events = tenders.flatMap(t => (t.events || [])).slice(0, 20)

  let body
  if (view === 'detail' && tenderId) {
    body = <TenderDetail id={tenderId} profile={profile} onBack={() => go('list')} />
  } else if (view === 'dash') {
    body = <BuyerDashboard tenders={tenders} events={events} profile={profile}
             onOpen={open} onCreate={() => setSheet('create')} />
  } else if (view === 'users') {
    body = <AdminUsers profile={profile} />
  } else if (view === 'mybids') {
    body = <MyBids tenders={tenders} profile={profile} onOpen={open} />
  } else if (view === 'feed') {
    body = <Feed tenders={tenders} onOpen={open} />
  } else {
    body = <TenderList tenders={tenders} profile={profile} onOpen={open} onCreate={() => setSheet('create')} />
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img className="logo" src="/cjx-logo.png" alt="CJx" />
          <span><b>ระบบประมูลจัดซื้อ</b>
            <span className="dim" style={{ fontSize: '.72rem' }}>e-Bidding Portal</span></span>
        </div>
        <nav className="nav">
          {items.map(i => (
            <button key={i.v} onClick={() => go(i.v)} aria-current={i.cur ? 'page' : undefined}>
              {i.ic}<span>{i.label}</span>
              {i.badge != null && <span className="badge">{i.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="whoami">
          <div className="row" style={{ gap: '.5rem', flexWrap: 'nowrap' }}>
            <span className="avatar">{profile.org.replace(/^(บจก\.|หจก\.)\s*/, '').slice(0, 2)}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: '.82rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile.org}</b>
              <span className="dim">{profile.full_name}</span>
            </span>
          </div>
          <button className="btn sm block" onClick={() => setPwOpen(true)}>เปลี่ยนรหัสผ่าน</button>
          <button className="btn sm block" onClick={() => signOut()}>ออกจากระบบ</button>
        </div>
      </aside>

      <main className="main">
        <div className="mtop">
          <img className="logo sm" src="/cjx-logo.png" alt="CJx" />
          <b style={{ fontFamily: 'var(--font-d)', fontSize: '.9rem', flex: 1 }}>{profile.org}</b>
          <button className="btn ghost sm" onClick={() => signOut()}>ออกจากระบบ</button>
        </div>
        {loading && !tenders.length ? <div className="page"><p className="dim">กำลังโหลด…</p></div> : body}
      </main>

      <nav className="tabbar">
        {items.map(i => (
          <button key={i.v} onClick={() => go(i.v)} aria-current={i.cur ? 'page' : undefined}>
            {i.ic}<span>{i.label}</span>
          </button>
        ))}
      </nav>

      {pwOpen && <ChangePassword mode="sheet" profile={profile} onClose={() => setPwOpen(false)}
                                 onDone={() => setPwOpen(false)} />}

      {sheet === 'create' && (
        <CreateTender suppliers={suppliers} onClose={() => setSheet(null)}
                      onCreated={id => { setSheet(null); reload(); open(id) }} />
      )}
    </div>
  )
}

// ---------------- บัญชียังไม่ได้ผูกกับบริษัท ----------------
function Unlinked({ profile }) {
  return (
    <div className="login">
      <div className="loginbox">
        <div className="row" style={{ gap: '.7rem' }}>
          <img className="logo" src="/cjx-logo.png" alt="CJx" style={{ height: 52 }} />
          <span><b style={{ fontFamily: 'var(--font-d)', fontSize: '1rem', display: 'block' }}>ระบบประมูลจัดซื้อ</b>
            <span className="dim">Supplier e-Bidding Portal</span></span>
        </div>
        <div className="card pad stack">
          <h1 style={{ fontSize: '1.15rem' }}>บัญชีนี้ยังไม่ได้เปิดใช้งาน</h1>
          <div className="rule" style={{ borderLeftColor: 'var(--warn)', background: 'var(--warn-wash)' }}>
            <b>{profile.email}</b><br />
            เข้าสู่ระบบได้แล้ว แต่ยังไม่ได้ผูกกับบริษัทผู้ขาย จึงยังไม่เห็นงานประมูล
          </div>
          <p className="muted" style={{ fontSize: '.92rem' }}>
            กรุณาแจ้งฝ่ายจัดซื้อให้ผูกบัญชีนี้กับบริษัทของท่าน (เมนู “ผู้ใช้และผู้ขาย” → บัญชีที่ยังไม่ได้ผูก)
            แล้วเข้าสู่ระบบอีกครั้ง
          </p>
          <button className="btn block" onClick={() => signOut()}>ออกจากระบบ</button>
        </div>
      </div>
    </div>
  )
}

// ---------------- ราคาของฉัน (ผู้ขาย) ----------------
function MyBids({ tenders, profile, onOpen }) {
  const rows = tenders.filter(t => t.my_bid)
  const wins = rows.filter(t => t.my_bid_won).length
  const sum = rows.reduce((s, t) => s + Number(t.my_bid.total || 0), 0)
  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow stack" style={{ gap: '.2rem' }}>
          <span className="eyebrow">ประวัติการเสนอราคา</span><h1>ราคาที่คุณยื่น</h1></div>
        {rows.length > 0 && (
          <button className="btn" onClick={() => {
            downloadCSV('ราคาที่ยื่นทั้งหมด', myBidRows(tenders, statusLabel))
            toast('ดาวน์โหลดแล้ว', `ราคาที่ยื่นทั้งหมด.csv — ${rows.length} รายการ`, 'good')
          }}>ดาวน์โหลด CSV</button>
        )}
      </div>
      <div className="grid g4">
        <div className="stat"><span className="eyebrow">ยื่นทั้งหมด</span><span className="v">{rows.length}</span></div>
        <div className="stat"><span className="eyebrow">ชนะ</span><span className="v" style={{ color: 'var(--good)' }}>{wins}</span></div>
        <div className="stat"><span className="eyebrow">มูลค่าที่เสนอรวม</span>
          <span className="v">฿{Math.round(sum).toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="eyebrow">อัตราชนะ</span>
          <span className="v">{rows.length ? Math.round(wins / rows.length * 100) : 0}%</span></div>
      </div>
      <div className="card"><header><h3>รายการ</h3></header>
        <div className="bids">
          {rows.length ? rows.map(t => (
            <div className="bid" key={t.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
              <span className="rank">{t.my_bid_won ? ICON.check : statusOf(t) === 'live' ? '…' : '—'}</span>
              <span className="who"><b>{t.title}</b><span className="dim">{t.code}</span></span>
              <span className="amt"><span className="v">฿{Math.round(t.my_bid.total).toLocaleString('th-TH')}</span>
                <span className="d">{t.my_bid_won ? 'ชนะ' : statusOf(t) === 'live' ? 'กำลังแข่ง' : 'รอผล'}</span></span>
            </div>
          )) : <div style={{ padding: '1rem' }} className="dim">ยังไม่เคยยื่นราคา</div>}
        </div>
      </div>
    </div>
  )
}

// ---------------- ความเคลื่อนไหวรวม ----------------
function Feed({ tenders, onOpen }) {
  const rows = tenders.flatMap(t => (t.events || []).map(e => ({ ...e, tender: t })))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return (
    <div className="page">
      <div className="pagehead"><div className="grow stack" style={{ gap: '.2rem' }}>
        <span className="eyebrow">การแจ้งเตือน</span><h1>ความเคลื่อนไหวทั้งหมด</h1></div></div>
      <div className="card pad">
        {rows.length ? (
          <div className="feed" style={{ maxHeight: 'none' }}>
            {rows.map(e => (
              <div className="ev" key={e.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(e.tender.id)}>
                <time>{new Date(e.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        ) : <p className="dim">ยังไม่มีความเคลื่อนไหว</p>}
      </div>
    </div>
  )
}

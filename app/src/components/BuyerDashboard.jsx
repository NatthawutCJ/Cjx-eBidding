import { baht, statusOf, clock } from '../lib/format'
import { ICON } from './bits'
import { TenderRow } from './TenderList.jsx'

export default function BuyerDashboard({ tenders, events, profile, onOpen, onCreate }) {
  const live = tenders.filter(t => statusOf(t) === 'live')
  const toUnseal = tenders.filter(t => t.type === 'sealed' && !t.unsealed_at && statusOf(t) === 'closed')
  const awarded = tenders.filter(t => t.awarded_bid_id)
  const bidsTotal = tenders.reduce((s, t) => s + (t.bid_count || 0), 0)

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow stack" style={{ gap: '.2rem' }}>
          <span className="eyebrow">ภาพรวมฝ่ายจัดซื้อ</span>
          <h1>สวัสดี {profile.full_name.split(' ')[0]}</h1>
          <p className="muted">{live.length} งานกำลังเปิดรับราคา · {toUnseal.length} งานรอเปิดซอง</p>
        </div>
        <button className="btn primary" onClick={onCreate}>{ICON.plus} สร้างประกาศ</button>
      </div>

      <div className="grid g4">
        <div className="stat"><span className="eyebrow">เปิดรับราคา</span><span className="v">{live.length}</span>
          <span className="dim">จากทั้งหมด {tenders.length} ประกาศ</span></div>
        <div className="stat"><span className="eyebrow">ใบเสนอราคาทั้งหมด</span><span className="v">{bidsTotal}</span>
          <span className="dim">รวมทุกงาน</span></div>
        <div className="stat"><span className="eyebrow">รอเปิดซอง</span>
          <span className="v" style={{ color: toUnseal.length ? 'var(--warn)' : 'inherit' }}>{toUnseal.length}</span>
          <span className="dim">ต้องดำเนินการ</span></div>
        <div className="stat"><span className="eyebrow">ปิดจบแล้ว</span>
          <span className="v" style={{ color: 'var(--good)' }}>{awarded.length}</span>
          <span className="dim">ประกาศผู้ชนะแล้ว</span></div>
      </div>

      {toUnseal.length > 0 && (
        <div className="card">
          <header><h3>รอเปิดซอง</h3><span className="chip warn">{toUnseal.length}</span></header>
          <div className="tlist">{toUnseal.map(t => <TenderRow key={t.id} t={t} profile={profile} onOpen={onOpen} />)}</div>
        </div>
      )}

      <div className="split">
        <div className="card">
          <header><h3>กำลังเปิดรับราคา</h3></header>
          <div className="tlist">
            {live.length ? live.map(t => <TenderRow key={t.id} t={t} profile={profile} onOpen={onOpen} />)
              : <div style={{ padding: '1rem' }} className="dim">—</div>}
          </div>
        </div>
        <div className="card">
          <header><h3>ความเคลื่อนไหวล่าสุด</h3></header>
          <div className="body">
            {events.length ? (
              <div className="feed">
                {events.slice(0, 14).map(e => (
                  <div className="ev" key={e.id}><time>{clock(e.created_at)}</time><span>{e.message}</span></div>
                ))}
              </div>
            ) : <p className="dim">ยังไม่มีความเคลื่อนไหว</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

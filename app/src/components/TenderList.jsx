import { baht, num, stamp, statusOf, closingSoon } from '../lib/format'
import { ICON, TypeChip, StatusChip, HammerChip, Countdown } from './bits'

export function TenderRow({ t, profile, onOpen }) {
  const st = statusOf(t)
  const stripe = st === 'awarded' ? 'awarded' : st === 'closed' ? 'closed' : closingSoon(t) ? 'soon' : 'live'
  const mineBid = profile.role === 'supplier' && t.my_bid
  const ham = t.hammer_supplier_id
  const showHammer = profile.role === 'buyer' ? !!ham : ham === profile.supplier_id
  return (
    <button className="titem" onClick={() => onOpen(t.id)}>
      <span className={'stripe ' + stripe} />
      <span className="t">
        <span className="row" style={{ gap: '.4rem' }}>
          <TypeChip t={t} /><StatusChip t={t} />
          {mineBid && <span className="chip flat">{ICON.check}ยื่นราคาแล้ว</span>}
          {showHammer && <HammerChip mine={profile.role !== 'buyer'} />}
        </span>
        <b>{t.title}</b>
        <span className="dim num">
          {t.code} · งบ {baht(t.budget)} · {t.items.length} รายการ · {t.bid_count} ใบเสนอราคา
        </span>
      </span>
      <span className="r">
        <Countdown t={t} />
        <span className="dim">ปิดรับ {stamp(t.closes_at)}</span>
      </span>
    </button>
  )
}

export default function TenderList({ tenders, profile, onOpen, onCreate }) {
  const live = tenders.filter(t => statusOf(t) === 'live')
  const past = tenders.filter(t => statusOf(t) !== 'live')
  const isBuyer = profile.role === 'buyer'
  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow stack" style={{ gap: '.2rem' }}>
          <span className="eyebrow">ประกาศเชิญประมูล</span>
          <h1>{isBuyer ? 'ประกาศทั้งหมด' : 'งานที่คุณถูกเชิญ'}</h1>
          <p className="muted">
            {live.length} รายการกำลังเปิดรับราคา
            {!isBuyer && ' — ยื่นราคาก่อนหมดเวลาเพื่อเข้าร่วมพิจารณา'}
          </p>
        </div>
        {isBuyer && <button className="btn primary" onClick={onCreate}>{ICON.plus} สร้างประกาศ</button>}
      </div>

      <div className="card">
        <header><h3>กำลังเปิดรับราคา</h3><span className="chip live"><i className="dot pulse" />{live.length}</span></header>
        <div className="tlist">
          {live.length ? live.map(t => <TenderRow key={t.id} t={t} profile={profile} onOpen={onOpen} />)
            : <div style={{ padding: '1rem' }} className="dim">ยังไม่มีงานที่เปิดรับราคา</div>}
        </div>
      </div>

      <div className="card">
        <header><h3>ปิดรับ / ประกาศผล</h3><span className="chip flat">{past.length}</span></header>
        <div className="tlist">
          {past.length ? past.map(t => <TenderRow key={t.id} t={t} profile={profile} onOpen={onOpen} />)
            : <div style={{ padding: '1rem' }} className="dim">—</div>}
        </div>
      </div>
    </div>
  )
}

import { baht, canSeePrices, when, statusOf } from '../lib/format'
import { ICON, HammerChip } from './bits'

// ชื่อคู่แข่งในงานเปิดราคา: ปิดชื่อจริง แสดงเป็นผู้เสนอราคา A/B/C แบบคงที่
function maskName(t, bid, profile, letters) {
  const mine = bid.supplier_id === profile.supplier_id
  if (mine) return (bid.suppliers?.name || 'บริษัทของคุณ') + ' (คุณ)'
  if (profile.role === 'buyer') return bid.suppliers?.name || '—'
  return 'ผู้เสนอราคา ' + (letters[bid.supplier_id] || '?')
}

export default function Board({ t, profile }) {
  const isBuyer = profile.role === 'buyer'
  const canSee = canSeePrices(t)
  const bids = [...t.bids].sort((a, b) => a.total - b.total)
  const best = bids.length ? Number(bids[0].total) : 0
  const mine = !isBuyer ? bids.find(b => b.supplier_id === profile.supplier_id) : null
  const myRank = mine ? bids.findIndex(b => b.id === mine.id) + 1 : 0
  const hidden = Math.max(0, t.bid_count - bids.length)

  // ค้อน: server ตอบมาเป็น supplier_id (เมื่อราคาเปิดเผยแล้ว) หรือสถานะของใบตัวเอง (งานปิดราคา)
  const hamId = t.hammer_supplier_id
  // งานปิดราคาระหว่างประมูล: server บอกแค่ 'mine' | 'other' | 'none'
  const hs = t.my_hammer_state
  const ownHammer = !canSee && hs === 'mine' && mine ? mine.id : null
  const hamMine = (hamId && hamId === profile.supplier_id) || !!ownHammer

  const letters = {}
  ;[...new Set(bids.map(b => b.supplier_id))].sort().forEach((id, i) => {
    letters[id] = String.fromCharCode(65 + i)
  })

  const rule = t.type === 'open'
    ? <div className="rule"><b>ประมูลแบบเปิดราคา</b> — ทุกฝ่ายเห็นราคาของกันแบบเรียลไทม์ ปรับราคาได้จนหมดเวลา
        {!isBuyer && ' ชื่อคู่แข่งถูกปิดไว้ แสดงเป็นผู้เสนอราคา A/B/C'}</div>
    : t.unsealed_at
      ? <div className="rule"><b>เปิดซองแล้ว</b> — ราคาทุกรายเปิดเผยต่อผู้เข้าร่วมทั้งหมด</div>
      : <div className="rule"><b>ประมูลแบบปิดราคา</b> — {isBuyer
          ? 'ฝ่ายจัดซื้อก็อ่านราคาไม่ได้จนกดเปิดซองหลังหมดเวลา กฎนี้บังคับที่ระดับฐานข้อมูล'
          : 'คุณเห็นได้เฉพาะราคาของตัวเอง ปรับราคาได้ไม่จำกัดจนหมดเวลา ระบบบอกเพียงว่าราคาของคุณถึงเกณฑ์ผู้ซื้อแล้วหรือยัง'}</div>

  return (
    <div className="card">
      <header>
        <h3>{t.type === 'open' ? 'กระดานราคาสด' : 'ใบเสนอราคา'}</h3>
        <span className="chip flat">{t.bid_count} ราย</span>
        {t.type === 'open' && statusOf(t) === 'live' &&
          <span className="chip onair"><i className="dot pulse" />LIVE</span>}
      </header>

      <div className="body" style={{ padding: '.75rem 1rem' }}>{rule}</div>

      <div className="bids">
        {bids.length === 0 && (
          <div className="bid"><span className="rank">—</span>
            <span className="who muted">ยังไม่มีราคาที่คุณเห็นได้</span><span className="amt" /></div>
        )}
        {bids.map((b, idx) => {
          const isMine = b.supplier_id === profile.supplier_id
          const isHam = (hamId && b.supplier_id === hamId) || (ownHammer && b.id === ownHammer)
          const diff = idx > 0 ? Number(b.total) - best : 0
          return (
            <div className={`bid ${isMine ? 'me' : ''} ${idx === 0 && canSee ? 'win' : ''} ${isHam ? 'hammer' : ''}`} key={b.id}>
              <span className="rank">{isHam ? ICON.gavel : (canSee ? idx + 1 : '—')}</span>
              <span className="who">
                <b>{maskName(t, b, profile, letters)}</b>
                {isHam && <span style={{ display: 'block', margin: '.15rem 0' }}><HammerChip mine={hamMine && isMine} /></span>}
                <span className="dim">
                  {(b.bid_files || []).length} เอกสาร
                  {b.version > 1 && ` · แก้ไข ${b.version} ครั้ง`} · {when(b.submitted_at)}
                </span>
              </span>
              <span className="amt">
                <span className="v">{baht(b.total)}</span>
                <span className={'d ' + (canSee && idx === 0 ? 'down' : canSee ? 'up' : '')}>
                  {!canSee ? 'ราคาที่คุณยื่น' : idx === 0 ? 'ราคาต่ำสุด' : '+' + baht(diff)}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {hidden > 0 && (
        <div className="body" style={{ padding: '.7rem 1rem', borderTop: '1px solid var(--line)' }}>
          <div className="bid" style={{ padding: 0, border: 0 }}>
            <span className="rank">{ICON.lock}</span>
            <span className="who"><b>อีก {hidden} ราย ยื่นราคาแล้ว</b>
              <span className="dim">ราคาถูกปิดไว้ตามประเภทการประมูล</span></span>
            <span className="amt"><span className="v locked">฿0,000,000</span></span>
          </div>
        </div>
      )}

      {/* ราคาคาดหวัง: ฝ่ายจัดซื้อเท่านั้น (ผู้ขายได้ค่า null จาก RLS) */}
      {isBuyer && t.target_price != null && (
        <div className="body" style={{ padding: '.7rem 1rem', borderTop: '1px solid var(--line)' }}>
          <div className="spread"><span className="muted">ราคาคาดหวัง (ภายใน)</span>
            <b className="num">{baht(t.target_price)}</b></div>
          {!canSee
            ? <p className="dim">เทียบกับราคาที่ยื่นได้หลังเปิดซอง</p>
            : hamId
              ? <p className="dim" style={{ color: 'var(--warn)' }}>
                  {bids.find(b => b.supplier_id === hamId)?.suppliers?.name} ถือค้อนอยู่ที่ {baht(best)} —
                  ต่ำกว่าราคาคาดหวัง {baht(t.target_price - best)} ถ้ามีรายอื่นเสนอต่ำกว่านี้ ค้อนย้ายทันที
                </p>
              : bids.length
                ? <p className="dim">ยังไม่มีรายใดถึงราคาคาดหวัง ต่ำสุดขณะนี้สูงกว่าเป้า {baht(best - t.target_price)}</p>
                : <p className="dim">ยังไม่มีผู้ยื่นราคา</p>}
        </div>
      )}

      {/* อันดับของผู้ขาย + สถานะค้อน (ไม่เผยตัวเลขราคาคาดหวัง) */}
      {/* งานปิดราคาระหว่างประมูล: บอกเฉพาะสถานะของใบตัวเอง ไม่บอกเรื่องคู่แข่ง */}
      {mine && !canSee && hs && (
        <div className="body" style={{ padding: '.7rem 1rem', borderTop: '1px solid var(--line)' }}>
          <div className="spread"><span className="muted">สถานะค้อน</span>
            <b style={{ color: hs === 'mine' ? 'var(--warn)' : 'var(--ink-2)' }}>
              {hs === 'mine' ? <>{ICON.gavel} ค้อนอยู่ที่คุณ</>
                : hs === 'other' ? 'ค้อนอยู่ที่รายอื่น' : 'ยังไม่มีใครได้ค้อน'}</b></div>
          <p className="dim">{
            hs === 'mine' ? 'ราคาของคุณถึงเกณฑ์ผู้ซื้อและต่ำสุดขณะนี้ — ถ้ามีรายอื่นเสนอต่ำกว่า ค้อนจะย้ายไปทันที'
            : hs === 'other' ? 'มีรายอื่นเสนอต่ำกว่าคุณและถึงเกณฑ์แล้ว ลดราคาแล้วหยอดใหม่เพื่อชิงค้อนกลับมา (ระบบไม่บอกราคาและชื่อของเขา)'
            : 'ยังไม่มีรายใดถึงเกณฑ์ที่ผู้ซื้อกำหนด ลดราคาแล้วหยอดใหม่ได้ไม่จำกัด'}</p>
        </div>
      )}

      {mine && canSee && (
        <div className="body" style={{ padding: '.7rem 1rem', borderTop: '1px solid var(--line)' }}>
          <div className="spread"><span className="muted">อันดับของคุณ</span>
            <b className="num">{myRank} จาก {bids.length}</b></div>
          {myRank > 1
            ? <p className="dim">ต่ำกว่าอันดับ 1 อยู่ {baht(Number(mine.total) - best)} — ปรับราคาได้จนหมดเวลา</p>
            : <p className="dim" style={{ color: 'var(--good)' }}>คุณอยู่อันดับ 1 ขณะนี้</p>}
          {hamId && (hamMine
            ? <p className="dim" style={{ color: 'var(--warn)' }}>{ICON.gavel} ราคาของคุณถึงเกณฑ์ที่ผู้ซื้อกำหนดแล้ว จึงถือค้อนอยู่ — หากมีรายอื่นเสนอต่ำกว่า ค้อนย้ายไปรายนั้นทันที</p>
            : <p className="dim">ค้อนอยู่ที่ผู้เสนอราคาอันดับ 1 — เสนอต่ำกว่าเพื่อชิงกลับมา</p>)}
        </div>
      )}
    </div>
  )
}

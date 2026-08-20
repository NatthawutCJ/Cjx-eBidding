import { useMemo, useState } from 'react'
import { baht, baht2, num, kb, ext, statusOf, stamp } from '../lib/format'
import { submitBid, uploadBidFiles } from '../lib/api'
import { TypeChip, StatusChip, DocList, Req, toast, ICON } from './bits'

export default function BidForm({ t, profile, onDone }) {
  const myBid = t.bids.find(b => b.supplier_id === profile.supplier_id)
  const st = statusOf(t)

  const initial = useMemo(() => {
    const o = {}
    if (myBid) (myBid.bid_lines || []).forEach(l => { o[l.item_id] = String(l.unit_price) })
    return o
  }, [myBid?.id])

  const [lines, setLines] = useState(initial)
  const [note, setNote] = useState(myBid?.note || '')
  const [files, setFiles] = useState([])          // File[] ที่เพิ่งเลือก
  const [busy, setBusy] = useState(false)

  const total = t.items.reduce((s, it) => s + (Number(lines[it.id]) || 0) * Number(it.qty), 0)
  const locked = false                            // ยื่นซ้ำได้ทั้งงานปิดและเปิด
  const needDocs = t.required_docs.length
  const haveDocs = files.length || (myBid?.bid_files?.length ?? 0)

  // โหมดหยอดราคา: ไม่บังคับแนบไฟล์ตอนประมูล ทั้งงานปิดและเปิด
  const bidding = true
  const isSealed = t.type === 'sealed'
  const sorted = [...t.bids].sort((a, b) => a.total - b.total)
  const best = sorted.length ? Number(sorted[0].total) : 0
  const iLead = !isSealed && sorted.length > 0 && sorted[0].supplier_id === profile.supplier_id
  const hasBase = t.items.every(it => Number(lines[it.id]) > 0)

  // ลดราคาทุกรายการตามสัดส่วน (ปัดลงเพื่อให้ยอดรวมไม่เกินเป้าที่กด)
  function quick(mode, pct) {
    if (!hasBase) return toast('กรอกราคาให้ครบก่อน', 'ปุ่มลดราคาใช้สัดส่วนจากราคาที่กรอกไว้', 'crit')
    const target = mode === 'beat' ? best * (1 - pct / 100) : total * (1 - pct / 100)
    if (!(target > 0)) return
    const f = target / total
    const next = {}
    t.items.forEach(it => { next[it.id] = String(Math.floor(Number(lines[it.id]) * f * 100) / 100) })
    setLines(next)
    toast(mode === 'beat' ? `ตั้งราคาต่ำกว่าอันดับ 1 อยู่ ${pct}%` : `ลดราคาลง ${pct}%`, 'ตรวจแล้วกดหยอดราคา')
  }

  // ---------- ปิดรับแล้ว: แสดงสรุปเท่านั้น ----------
  if (st !== 'live') {
    return (
      <div className="card">
        <header><h3>ใบเสนอราคาของคุณ</h3><StatusChip t={t} /></header>
        <div className="body stack">
          {myBid ? <>
            <div className="spread"><span className="muted">ราคารวมที่ยื่นไว้</span>
              <b className="num" style={{ fontSize: '1.25rem' }}>{baht2(myBid.total)}</b></div>
            <p className="dim">ยื่นเมื่อ {stamp(myBid.submitted_at)}{myBid.version > 1 && ` (แก้ไข ${myBid.version} ครั้ง)`}</p>
            <DocList files={myBid.bid_files} bucket="bid-files" />
          </> : <p className="muted">ปิดรับราคาแล้ว และคุณไม่ได้ยื่นราคาในงานนี้</p>}
        </div>
      </div>
    )
  }

  async function onSubmit(e) {
    e.preventDefault()
    const missing = t.items.filter(it => !(Number(lines[it.id]) > 0))
    if (missing.length) return toast('ยังกรอกราคาไม่ครบ', `เหลือ ${missing.length} รายการ`, 'crit')
    // ไม่บังคับเอกสารตอนหยอดราคา — ส่งภายใน 3 วันหลังปิดประมูล (การ์ด "ส่งเอกสารประกอบ")

    setBusy(true)
    try {
      // อัปโหลดไฟล์ก่อน แล้วส่ง path ไปให้ submit_bid บันทึกในทีเดียว
      // ไม่ส่งไฟล์ = server เก็บเอกสารเดิมไว้ให้ (ดู submit_bid ใน 03_functions.sql)
      const uploaded = files.length ? await uploadBidFiles(t.id, profile.supplier_id, files) : []

      const payload = t.items
        .map(it => ({ item_id: it.id, unit_price: Number(lines[it.id]) }))
        .filter(l => l.unit_price > 0)

      await submitBid(t.id, payload, note, uploaded)
      toast(myBid ? 'หยอดราคาใหม่แล้ว' : 'หยอดราคาแล้ว',
            isSealed ? `${t.code} · ราคาปิดผนึกไว้จนถึงเวลาเปิดซอง` : baht(total), 'good')
      // สถานะค้อนล่าสุดจะอัปเดตเองเมื่อ onDone() โหลดข้อมูลใหม่
      setFiles([])
      onDone?.()
    } catch (err) {
      toast('ยื่นราคาไม่สำเร็จ', err.message, 'crit')
    } finally { setBusy(false) }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <header>
        <h3>{myBid ? 'ปรับราคา' : 'ยื่นใบเสนอราคา'}</h3>
        <TypeChip t={t} />
        {myBid && <span className="chip flat">แก้ไขครั้งที่ {myBid.version + 1}</span>}
      </header>

      <div className="body stack">
        {isSealed && <div className="rule">
          <b>ประมูลแบบปิดราคา</b> — ไม่มีใครเห็นราคาของกัน แต่ปรับราคาได้ไม่จำกัดจนหมดเวลา
          ระบบจะบอกเฉพาะว่าราคาของคุณถึงเกณฑ์ที่ผู้ซื้อกำหนดแล้วหรือยัง
        </div>}

        {myBid && t.my_hammer_state && (
          <div className="rule" style={t.my_hammer_state === 'mine'
            ? { borderLeftColor: 'var(--warn)', background: 'var(--warn-wash)' }
            : { borderLeftColor: 'var(--line-strong)', background: 'var(--surface-2)' }}>
            {t.my_hammer_state === 'mine'
              ? <><b>{ICON.gavel} ค้อนอยู่ที่คุณ</b> — ราคาถึงเกณฑ์ผู้ซื้อและต่ำสุดขณะนี้ ถ้ามีรายอื่นเสนอต่ำกว่า ค้อนย้ายไปทันที</>
              : t.my_hammer_state === 'other'
                ? <><b>ค้อนหลุดมือแล้ว</b> — มีรายอื่นเสนอต่ำกว่าและถึงเกณฑ์ ลดราคาแล้วหยอดใหม่เพื่อชิงกลับมา</>
                : t.my_target_met
                  ? <><b>ราคาที่คุณยื่นถึงเกณฑ์แล้ว</b> — ยังลดเพิ่มเพื่อความมั่นใจได้</>
                  : <><b>ราคาที่คุณยื่นยังไม่ถึงเกณฑ์ที่ผู้ซื้อกำหนด</b> — ลดราคาแล้วหยอดใหม่ได้ไม่จำกัดจนหมดเวลา</>}
          </div>
        )}

        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>รายการ</th><th className="r">จำนวน</th>
              <th className="r" style={{ width: 130 }}>ราคา/หน่วย (บาท)</th><th className="r">รวม</th>
            </tr></thead>
            <tbody>
              {t.items.map(it => {
                const p = Number(lines[it.id]) || 0
                return (
                  <tr key={it.id}>
                    <td><b style={{ fontWeight: 600 }}>{it.name}</b><br /><span className="dim">{it.spec}</span></td>
                    <td className="r mono">{num(it.qty)}<br /><span className="dim">{it.unit}</span></td>
                    <td className="r">
                      <input type="number" step="0.01" min="0" inputMode="decimal" className="num"
                             value={lines[it.id] ?? ''} disabled={locked} placeholder="0.00" required
                             onChange={e => setLines({ ...lines, [it.id]: e.target.value })} />
                    </td>
                    <td className="r mono">{p ? baht2(p * Number(it.qty)) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan="3" className="r">ราคารวมทั้งสิ้น (ก่อน VAT)</td>
                  <td className="r mono" style={{ fontSize: '1.05rem' }}>{total ? baht2(total) : '—'}</td></tr>
              <tr><td colSpan="3" className="r dim" style={{ fontWeight: 400 }}>เทียบงบประมาณ {baht(t.budget)}</td>
                  <td className="r mono dim">{total ? ((total - t.budget) / t.budget * 100).toFixed(1) + '%' : '—'}</td></tr>
            </tfoot>
          </table>
        </div>

        {bidding ? (
          <div>
            <div className="spread" style={{ marginBottom: '.4rem' }}>
              <span className="eyebrow">หยอดราคาเร็ว — ลดราคาของคุณ</span>
              {hasBase && <span className="dim">จากยอด {baht(total)}</span>}
            </div>
            <div className="row" style={{ gap: '.4rem' }}>
              {[5, 10, 15, 20].map(pct => (
                <button key={pct} type="button" className="btn sm" disabled={!hasBase}
                        title={hasBase ? 'เหลือ ' + baht(Math.floor(total * (1 - pct / 100))) : undefined}
                        onClick={() => quick('cut', pct)}>−{pct}%</button>
              ))}
            </div>
            {!isSealed && best > 0 && !iLead && (
              <div className="row" style={{ gap: '.4rem', marginTop: '.45rem' }}>
                <button type="button" className="btn sm primary" disabled={!hasBase} onClick={() => quick('beat', 1)}>
                  ต่ำกว่าอันดับ 1 อยู่ 1%
                </button>
                <span className="dim">คำนวณจากราคาต่ำสุดที่เห็นบนกระดาน</span>
              </div>
            )}
            <p className="dim" style={{ marginTop: '.4rem' }}>
              {hasBase ? 'กดแล้วราคาทุกรายการถูกลดตามสัดส่วนทันที ตรวจยอดรวมแล้วกด “หยอดราคา” เพื่อยืนยัน (ยังไม่ส่งจนกดยืนยัน)'
                       : 'กรอกราคาตั้งต้นให้ครบทุกรายการก่อน แล้วปุ่มลดราคาจะใช้งานได้'}
            </p>
          </div>
        ) : (
        <div>
          <div className="spread" style={{ marginBottom: '.4rem' }}>
            <span className="eyebrow">เอกสารแนบ</span>
            <span className="dim">{haveDocs}/{needDocs} ไฟล์</span>
          </div>
          <div className="stack" style={{ gap: '.5rem' }}>
            {t.required_docs.map((d, i) => <Req key={d.id} ok={haveDocs > i}>{d.label}</Req>)}
          </div>

          {myBid?.bid_files?.length > 0 && !files.length &&
            <div style={{ marginTop: '.6rem' }}><DocList files={myBid.bid_files} bucket="bid-files" /></div>}

          {files.length > 0 && (
            <div className="docs" style={{ marginTop: '.6rem' }}>
              {files.map((f, i) => (
                <div className="doc" key={i}>
                  <span className="ext">{ext(f.name)}</span>
                  <span className="n">{f.name}</span>
                  <span className="dim num">{kb(f.size)}</span>
                  <button type="button" className="btn ghost sm"
                          onClick={() => setFiles(files.filter((_, j) => j !== i))}>ลบ</button>
                </div>
              ))}
            </div>
          )}

          {!locked && (
            <label className="drop" style={{ marginTop: '.6rem' }}>
              <input type="file" multiple style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                     onChange={e => {
                       const picked = [...e.target.files].filter(f => {
                         if (f.size > 20 * 1048576) { toast('ไฟล์ใหญ่เกินกำหนด', `${f.name} เกิน 20 MB`, 'crit'); return false }
                         return true
                       })
                       setFiles([...files, ...picked]); e.target.value = ''
                     }} />
              <b style={{ fontFamily: 'var(--font-d)' }}>เลือกไฟล์เพื่อแนบ</b>
              <span className="dim" style={{ display: 'block' }}>PDF, JPG, PNG, XLSX — ไม่เกิน 20 MB ต่อไฟล์</span>
            </label>
          )}
        </div>
        )}

        <label className="f">
          <span>หมายเหตุ / เงื่อนไข (ยืนราคา, ระยะเวลาส่งมอบ, เงื่อนไขชำระเงิน)</span>
          <textarea value={note} disabled={locked} onChange={e => setNote(e.target.value)}
                    placeholder="เช่น ยืนราคา 30 วัน ส่งมอบภายใน 14 วันหลังรับ PO" />
        </label>
      </div>

      {!locked && (
        <footer style={{ padding: '.75rem 1rem', borderTop: '1px solid var(--line)', display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dim" style={{ flex: 1 }}>
            ช่วงประมูลไม่ต้องแนบไฟล์ ปรับราคาได้ไม่จำกัดจนหมดเวลา · เอกสารส่งภายใน 3 วันหลังปิดประมูล
          </span>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'กำลังส่ง…' : bidding ? (myBid ? 'หยอดราคาใหม่' : 'หยอดราคา') : (myBid ? 'ยืนยันราคาใหม่' : 'ยื่นใบเสนอราคา')}
          </button>
        </footer>
      )}
    </form>
  )
}

import { useEffect, useState } from 'react'
import { getTender, subscribeTender, unsealTender, awardBid, declineInvite, attachBidFiles, uploadBidFiles,
         cancelTender, deleteTender } from '../lib/api'
import { downloadCSV, tenderComparisonRows } from '../lib/csv'
import { baht, num, stamp, statusOf, canSeePrices, clock, cdText, docsDueAt, DOCS_GRACE_DAYS } from '../lib/format'
import { ICON, TypeChip, StatusChip, Countdown, DocList, Req, toast } from './bits'
import { useState as useLocalState } from 'react'
import Board from './Board.jsx'
import BidForm from './BidForm.jsx'

export default function TenderDetail({ id, profile, onBack }) {
  const [t, setT] = useState(null)
  const [err, setErr] = useState('')
  const isBuyer = profile.role === 'buyer'

  const load = () => getTender(id).then(setT).catch(e => setErr(e.message))

  useEffect(() => { load() }, [id])
  useEffect(() => subscribeTender(id, () => load()), [id])   // เรียลไทม์: มีคนยื่น/ปรับราคา

  if (err) return <div className="page"><p className="muted">{err}</p></div>
  if (!t) return <div className="page"><p className="dim">กำลังโหลด…</p></div>

  const st = statusOf(t)
  const canSee = canSeePrices(t)
  const bids = [...t.bids].sort((a, b) => a.total - b.total)
  const best = bids.length ? Number(bids[0].total) : 0
  const hamId = t.hammer_supplier_id
  const hasBudget = t.budget != null   // ฝ่ายจัดซื้อเท่านั้น — ผู้ขายได้ null มาจาก RLS

  const act = async (fn, okTitle, okText) => {
    try { await fn(); toast(okTitle, okText, 'good'); load() }
    catch (e) { toast('ทำรายการไม่สำเร็จ', e.message, 'crit') }
  }

  return (
    <div className="page">
      <div><button className="btn ghost sm" onClick={onBack}>{ICON.back} กลับ</button></div>

      <div className="pagehead">
        <div className="grow stack" style={{ gap: '.45rem' }}>
          <div className="row" style={{ gap: '.4rem' }}>
            <TypeChip t={t} /><StatusChip t={t} />
            <span className="dim num">{t.code}</span>
          </div>
          <h1>{t.title}</h1>
          <p className="muted">{t.description}</p>
          {t.cancelled_at && (
            <div className="rule" style={{ borderLeftColor: 'var(--crit)', background: 'var(--crit-wash)' }}>
              <b>ประกาศนี้ถูกยกเลิกเมื่อ {stamp(t.cancelled_at)}</b><br />
              เหตุผล: {t.cancel_reason || '—'}
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: '.25rem', alignItems: 'flex-end', textAlign: 'right' }}>
          <span className="eyebrow">{st === 'live' ? 'เหลือเวลา' : 'เวลาปิดรับ'}</span>
          <span style={{ fontSize: '1.2rem' }}><Countdown t={t} /></span>
          <span className="dim">{stamp(t.closes_at)}</span>
        </div>
      </div>

      <div className="grid g4">
        {hasBudget ? (
          <div className="stat"><span className="eyebrow">งบประมาณ</span><span className="v">{baht(t.budget)}</span>
            <span className="dim">{ICON.lock} ผู้ขายไม่เห็นตัวเลขนี้</span></div>
        ) : isBuyer && (
          // ฝ่ายจัดซื้อต้องเห็นงบเสมอ ถ้าว่างแปลว่ายังไม่ได้ย้ายข้อมูลในฐานข้อมูล
          <div className="stat"><span className="eyebrow">งบประมาณ</span><span className="v">——</span>
            <span className="dim">ยังไม่ได้รัน 12_hide_budget.sql</span></div>
        )}
        {isBuyer ? (
          <div className="stat"><span className="eyebrow">ผู้ถูกเชิญ / ยื่นแล้ว</span>
            <span className="v">{t.bid_count}/{t.tender_invites?.length ?? '—'}</span>
            <div className="meter"><i style={{ width: `${Math.min(100, (t.bid_count / Math.max(1, t.tender_invites?.length || 1)) * 100)}%` }} /></div>
          </div>
        ) : (
          <div className="stat"><span className="eyebrow">ยื่นราคาแล้ว</span>
            <span className="v">{t.bid_count} ราย</span>
            <span className="dim">รวมบริษัทของคุณ</span>
          </div>
        )}
        {/* ไม่ render ตัวเลขที่ยังไม่ควรเปิดเผย — RLS ไม่ส่งมาให้อยู่แล้ว และห้ามเบลอด้วย CSS เพราะ DevTools อ่านได้ */}
        <div className="stat"><span className="eyebrow">ราคาต่ำสุด</span>
          <span className="v">{canSee ? (bids.length ? baht(best) : '—') : '฿ ——'}</span>
          {canSee && bids.length
            ? (hasBudget && <div className="meter"><i className={best <= t.budget ? 'good' : 'crit'}
                style={{ width: `${Math.min(100, (best / t.budget) * 100)}%` }} /></div>)
            : <span className="dim">{ICON.lock} ปิดไว้จนเปิดซอง</span>}
        </div>
        {hasBudget && (
          <div className="stat"><span className="eyebrow">ประหยัดจากงบ</span>
            <span className="v" style={{ color: canSee && bids.length && best <= t.budget ? 'var(--good)' : 'inherit' }}>
              {canSee && bids.length ? ((1 - best / t.budget) * 100).toFixed(1) + '%' : '——'}
            </span>
            {!canSee && <span className="dim">{ICON.lock} ปิดไว้จนเปิดซอง</span>}
          </div>
        )}
        {isBuyer && t.target_price != null && (
          <div className="stat"><span className="eyebrow">ราคาคาดหวัง (ภายใน)</span>
            <span className="v">{baht(t.target_price)}</span>
            {!canSee ? <span className="dim">{ICON.lock} เทียบได้หลังเปิดซอง</span>
              : hamId ? <span className="dim" style={{ color: 'var(--warn)' }}>{ICON.gavel} ถึงเป้าแล้ว · ต่ำกว่า {baht(t.target_price - best)}</span>
              : <span className="dim">{bids.length ? 'ยังไม่ถึงเป้า ต่างอีก ' + baht(best - t.target_price) : 'รอผู้ยื่นราคา'}</span>}
          </div>
        )}
      </div>

      <div className="split">
        <div className="stack">
          {t.files?.length > 0 && (
            <div className="card">
              <header><h3>เอกสารจากผู้ซื้อ</h3><span className="chip flat">{t.files.length} ไฟล์</span></header>
              <div className="body">
                <DocList files={t.files} bucket="tender-files" />
                <p className="dim" style={{ marginTop: '.55rem' }}>TOR และเอกสารประกอบ — ผู้ถูกเชิญทุกรายเปิดดูได้</p>
              </div>
            </div>
          )}

          {!isBuyer && <BidForm t={t} profile={profile} onDone={load} />}
          {!isBuyer && <LaterDocs t={t} profile={profile} onDone={load} />}

          {isBuyer && canSee && bids.length > 0 && (
            <div className="card">
              <header><h3>เปรียบเทียบรายรายการ</h3></header>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>รายการ</th><th className="r">จำนวน</th>
                    {bids.map(b => <th className="r" key={b.id}>
                      {hamId === b.supplier_id && ICON.gavel} {b.suppliers?.name?.replace(/^(บจก\.|หจก\.)\s*/, '')}
                    </th>)}
                  </tr></thead>
                  <tbody>
                    {t.items.map(it => {
                      const prices = bids.map(b => Number((b.bid_lines || []).find(l => l.item_id === it.id)?.unit_price) || 0)
                      const low = Math.min(...prices.filter(p => p > 0))
                      return (
                        <tr key={it.id}>
                          <td>{it.name}</td>
                          <td className="r mono dim">{num(it.qty)} {it.unit}</td>
                          {prices.map((p, i) => (
                            <td className="r mono" key={i}
                                style={p === low ? { color: 'var(--good)', fontWeight: 600 } : undefined}>
                              {p ? p.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan="2" className="r">รวม</td>
                    {bids.map(b => <td className="r mono" key={b.id}>{baht(b.total)}</td>)}
                  </tr></tfoot>
                </table>
              </div>
              <div className="body" style={{ padding: '.7rem 1rem', borderTop: '1px solid var(--line)' }}>
                {bids.map(b => (
                  <div key={b.id} style={{ marginBottom: '.6rem' }}>
                    <b style={{ fontSize: '.86rem' }}>{b.suppliers?.name}</b>
                    {b.note && <p className="dim">{b.note}</p>}
                    <DocList files={b.bid_files} bucket="bid-files" empty="ไม่มีเอกสารแนบ" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <header><h3>รายการที่ต้องการ</h3><span className="chip flat">{t.items.length} รายการ</span></header>
            <div className="tablewrap">
              <table>
                <thead><tr><th>รายการ</th><th>สเปก</th><th className="r">จำนวน</th></tr></thead>
                <tbody>{t.items.map(it => (
                  <tr key={it.id}><td><b style={{ fontWeight: 600 }}>{it.name}</b></td>
                    <td className="dim">{it.spec}</td>
                    <td className="r mono">{num(it.qty)} {it.unit}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {t.required_docs.length > 0 && (
            <div className="card pad stack">
              <span className="eyebrow">เอกสารที่ซัพพลายเออร์ต้องแนบ</span>
              {t.required_docs.map(d => <Req key={d.id} ok={false}>{d.label}</Req>)}
            </div>
          )}
        </div>

        <div className="stack">
          <Board t={t} profile={profile} />

          {isBuyer && (
            <div className="card pad stack">
              <span className="eyebrow">การดำเนินการของฝ่ายจัดซื้อ</span>
              {t.type === 'sealed' && !t.unsealed_at && (
                <>
                  <button className="btn primary block" disabled={st === 'live'}
                          onClick={() => act(() => unsealTender(t.id), 'เปิดซองแล้ว', `${t.code} · ${t.bid_count} ใบเสนอราคา`)}>
                    {ICON.lock} เปิดซองราคา ({t.bid_count} ราย)
                  </button>
                  <p className="dim">{st === 'live'
                    ? 'เปิดซองได้หลังเวลาปิดรับเท่านั้น — เงื่อนไขนี้ตรวจที่ฐานข้อมูล กด API ตรงก็ไม่ผ่าน'
                    : 'พร้อมเปิดซอง ระบบจะบันทึกผู้กดและเวลาไว้'}</p>
                </>
              )}
              {st !== 'awarded' && canSee && bids.length > 0 && (
                <>
                  <button className="btn primary block"
                          onClick={() => act(() => awardBid(bids[0].id), 'อนุมัติผู้ชนะแล้ว', bids[0].suppliers?.name)}>
                    {hamId && ICON.gavel} อนุมัติผู้ชนะ — {bids[0].suppliers?.name}
                  </button>
                  <p className="dim">ราคาต่ำสุด {baht(best)}{hasBudget && ' · ประหยัดจากงบ ' + baht(t.budget - best)}
                    {t.target_price != null && (hamId ? ' · ถึงราคาคาดหวังแล้ว' : ' · ยังไม่ถึงราคาคาดหวัง')}</p>
                  {(bids[0].bid_files || []).length < t.required_docs.length && (
                    <div className="rule" style={{ borderLeftColor: 'var(--warn)', background: 'var(--warn-wash)' }}>
                      <b>ผู้เสนอราคาต่ำสุดยังแนบเอกสารไม่ครบ</b> ({(bids[0].bid_files || []).length}/{t.required_docs.length}) —
                      ส่งเอกสารได้ถึง {stamp(docsDueAt(t))} ({DOCS_GRACE_DAYS} วันหลังปิดประมูล) ควรเรียกให้ครบก่อนอนุมัติ
                    </div>
                  )}
                </>
              )}
              {st === 'awarded' && (
                <div className="rule"><b>ผู้ชนะ: {bids.find(b => b.id === t.awarded_bid_id)?.suppliers?.name}</b><br />
                  ประกาศผลเมื่อ {stamp(t.awarded_at)}</div>
              )}

              {canSee && bids.length > 0 && (
                <button className="btn block" onClick={() => {
                  downloadCSV(`${t.code}-เปรียบเทียบราคา`, tenderComparisonRows(t))
                  toast('ดาวน์โหลดแล้ว', `${t.code}-เปรียบเทียบราคา.csv — เปิดด้วย Excel ได้เลย`, 'good')
                }}>ดาวน์โหลดใบเปรียบเทียบ (CSV)</button>
              )}

              {!t.cancelled_at && st !== 'awarded' && (
                <>
                  <button className="btn block danger" onClick={async () => {
                    const reason = window.prompt('เหตุผลการยกเลิกประกาศนี้ (ผู้ขายทุกรายจะเห็นข้อความนี้)')
                    if (!reason) return
                    try { await cancelTender(t.id, reason); toast('ยกเลิกประกาศแล้ว', t.code, 'good'); load() }
                    catch (e) { toast('ยกเลิกไม่สำเร็จ', e.message, 'crit') }
                  }}>ยกเลิกประกาศ</button>

                  {t.bid_count === 0 && (
                    <button className="btn block danger" onClick={async () => {
                      if (!window.confirm(`ลบประกาศ ${t.code} ออกจากระบบถาวร?\n\nยังไม่มีใครยื่นราคา จึงลบได้ — การลบย้อนกลับไม่ได้`)) return
                      try {
                        await deleteTender(t.id, t.files)
                        toast('ลบประกาศแล้ว', t.code, 'good')
                        onBack()
                      } catch (e) { toast('ลบไม่สำเร็จ', e.message, 'crit') }
                    }}>ลบประกาศ (ยังไม่มีผู้ยื่นราคา)</button>
                  )}
                  <p className="dim">
                    {t.bid_count === 0
                      ? 'ลบได้เพราะยังไม่มีใบเสนอราคา — ถ้ามีแล้วระบบจะให้ยกเลิกเท่านั้น เพื่อเก็บหลักฐานไว้'
                      : `มีใบเสนอราคาแล้ว ${t.bid_count} ราย จึงลบไม่ได้ ใช้ "ยกเลิกประกาศ" แทน ระบบจะเก็บทุกอย่างไว้พร้อมเหตุผล`}
                  </p>
                </>
              )}
            </div>
          )}

          {!isBuyer && st === 'live' && !t.bids.find(b => b.supplier_id === profile.supplier_id) && (
            <div className="card pad stack">
              <span className="eyebrow">ไม่สะดวกเข้าร่วม</span>
              <button className="btn block"
                      onClick={() => act(() => declineInvite(t.id), 'แจ้งสละสิทธิ์แล้ว', t.code)}>
                ขอสละสิทธิ์ในงานนี้
              </button>
              <p className="dim">ฝ่ายจัดซื้อจะทราบทันที และยังมีเวลาเชิญรายอื่นเพิ่ม</p>
            </div>
          )}

          <div className="card">
            <header><h3>ความเคลื่อนไหว</h3></header>
            <div className="body">
              {t.events.length ? (
                <div className="feed">
                  {t.events.map(e => (
                    <div className="ev" key={e.id}><time>{clock(e.created_at)}</time><span>{e.message}</span></div>
                  ))}
                </div>
              ) : <p className="dim">ยังไม่มีความเคลื่อนไหวในรอบนี้</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


// ---------------- เอกสารประกอบ: ส่งหลังปิดประมูล ให้เวลา 3 วัน (ทั้งงานปิดและเปิด) ----------------
function LaterDocs({ t, profile, onDone }) {
  const myBid = t.bids.find(b => b.supplier_id === profile.supplier_id)
  const [busy, setBusy] = useLocalState(false)
  if (!myBid) return null

  const have = (myBid.bid_files || []).length
  const need = t.required_docs.length
  const ok = have >= need
  const st = statusOf(t)
  const dueAt = docsDueAt(t)
  const late = Date.now() > dueAt
  const checklist = t.required_docs.map((d, i) => <Req key={d.id} ok={have > i}>{d.label}</Req>)

  // --- ระหว่างประมูล: ยังไม่เปิดให้ส่ง ---
  if (st === 'live') {
    return (
      <div className="card">
        <header><h3>เอกสารประกอบ</h3><span className="chip flat">{ICON.lock}ส่งหลังปิดประมูล</span></header>
        <div className="body stack">
          <div className="rule">
            <b>ช่วงนี้ยังไม่ต้องส่งเอกสาร</b> — เน้นสู้ราคาให้เต็มที่ก่อน ระบบจะเปิดให้แนบเมื่อปิดรับราคา
            แล้วมีเวลาส่งอีก {DOCS_GRACE_DAYS} วัน (ครบกำหนด {stamp(dueAt)})
          </div>
          <span className="eyebrow">รายการที่ต้องเตรียมไว้</span>
          {checklist}
        </div>
      </div>
    )
  }

  async function onPick(e) {
    const picked = [...e.target.files].filter(f => {
      if (f.size > 20 * 1048576) { toast('ไฟล์ใหญ่เกินกำหนด', `${f.name} เกิน 20 MB`, 'crit'); return false }
      return true
    })
    e.target.value = ''
    if (!picked.length) return
    setBusy(true)
    try {
      const rows = await uploadBidFiles(t.id, profile.supplier_id, picked)
      const n = await attachBidFiles(t.id, rows)
      toast(n >= need ? 'เอกสารครบแล้ว' : 'แนบเอกสารแล้ว', `${n}/${need} รายการ`, n >= need ? 'good' : '')
      onDone?.()
    } catch (err) { toast('แนบเอกสารไม่สำเร็จ', err.message, 'crit') }
    finally { setBusy(false) }
  }

  return (
    <div className="card">
      <header><h3>ส่งเอกสารประกอบ</h3>
        {ok ? <span className="chip live">{ICON.check}ครบ {have}/{need}</span>
            : <span className={'chip ' + (late ? 'crit' : 'warn')}>{have}/{need} ไฟล์</span>}
      </header>
      <div className="body stack">
        <div className="rule" style={ok ? undefined
          : { borderLeftColor: `var(--${late ? 'crit' : 'warn'})`, background: `var(--${late ? 'crit' : 'warn'}-wash)` }}>
          {ok ? <><b>เอกสารครบแล้ว</b> — รอฝ่ายจัดซื้อพิจารณาผล</>
            : late ? <><b>เกินกำหนดส่งเอกสารแล้ว</b> — ครบกำหนด {stamp(dueAt)} ยังส่งได้ แต่ฝ่ายจัดซื้อมีสิทธิ์ตัดสิทธิ์ใบเสนอราคาของท่าน</>
            : <><b>ปิดรับราคาแล้ว กรุณาส่งเอกสารภายใน {cdText(dueAt - Date.now())}</b> — ครบกำหนด {stamp(dueAt)} ไม่ส่งตามกำหนดถือว่าสละสิทธิ์</>}
        </div>
        {checklist}
        {have > 0 && <DocList files={myBid.bid_files} bucket="bid-files" />}
        {st === 'awarded'
          ? <p className="dim">ประกาศผลแล้ว ปิดรับเอกสารเพิ่ม</p>
          : <label className="drop">
              <input type="file" multiple disabled={busy} onChange={onPick}
                     style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
              <b style={{ fontFamily: 'var(--font-d)' }}>{busy ? 'กำลังอัปโหลด…' : 'แนบเอกสารประกอบ'}</b>
              <span className="dim" style={{ display: 'block' }}>ไม่เกิน 20 MB ต่อไฟล์</span>
            </label>}
      </div>
    </div>
  )
}

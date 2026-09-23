import { useEffect, useState } from 'react'
import { createTender, uploadTenderFiles, tenderTimes } from '../lib/api'
import { ext, kb, stamp, SPEC_NOTE } from '../lib/format'
import { ICON, toast } from './bits'

const DEFAULT_DOCS = ['ใบเสนอราคาลงนาม (PDF)']

// เก็บแบบร่างไว้ในเครื่องผู้ใช้ กันพิมพ์ยาวแล้วกดปิดพลาด/รีเฟรชแล้วหายทั้งหมด
// เก็บเฉพาะข้อความและตัวเลือก — ไฟล์แนบเก็บไม่ได้ (เป็นอ็อบเจกต์ File ของเบราว์เซอร์)
const DRAFT_KEY = 'cjx-tender-draft'
const readDraft = () => {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* โหมดส่วนตัว */ } }
// ค่าเวลาสำหรับ <input type="datetime-local"> ต้องเป็นเวลาท้องถิ่น ไม่ใช่ UTC
const localAt = msFromNow => {
  const d = new Date(Date.now() + msFromNow); d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function CreateTender({ suppliers, onClose, onCreated }) {
  // อ่านแบบร่างครั้งเดียวตอนเปิดฟอร์ม ไม่ใช่ทุก render (ไม่งั้นเวลาที่โชว์จะขยับตามการพิมพ์)
  const [draft] = useState(readDraft)

  // ต้องเอาค่าตั้งต้นรองไว้เสมอ แบบร่างเก่าอาจไม่มีช่องที่เพิ่งเพิ่มเข้ามา (เช่น remark)
  // ถ้าเอาแบบร่างมาใช้ตรง ๆ ช่องใหม่จะเป็น undefined แล้วหน้าจอพังตอนเรียก .trim()
  const blank = () => ({
    title: '', type: 'sealed', budget: '', target_price: '',
    opens_at: localAt(0), closes_at: localAt(3 * 86400000), docs: DEFAULT_DOCS.join('\n'),
    remark: '',
  })
  const [f, setF] = useState({ ...blank(), ...(draft?.f || {}) })
  const [items, setItems] = useState(
    Array.isArray(draft?.items) && draft.items.length
      ? draft.items
      : [{ name: '', spec: '', qty: '', unit: 'ชิ้น' }])
  // ผู้ขายที่ถูกลบไปหลังบันทึกแบบร่างต้องไม่ติดมาด้วย
  const [invited, setInvited] = useState(
    Array.isArray(draft?.invited)
      ? draft.invited.filter(id => suppliers.some(s => s.id === id))
      : suppliers.map(s => s.id))
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [restored, setRestored] = useState(!!draft)
  const set = (k, v) => setF({ ...f, [k]: v })

  // บันทึกแบบร่างทุกครั้งที่มีการพิมพ์ (เฉพาะตอนที่กรอกอะไรไปแล้ว)
  useEffect(() => {
    const touched = f.title.trim() || f.budget || f.remark.trim() || items.some(i => i.name.trim())
    if (!touched) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ f, items, invited, at: Date.now() })) }
    catch { /* พื้นที่เต็มหรือโหมดส่วนตัว — ไม่ใช่เรื่องคอขาดบาดตาย */ }
  }, [f, items, invited])

  function resetForm() {
    clearDraft()
    setF(blank())
    setItems([{ name: '', spec: '', qty: '', unit: 'ชิ้น' }])
    setInvited(suppliers.map(s => s.id))
    setFiles([])
    setRestored(false)
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (new Date(f.opens_at) >= new Date(f.closes_at))
      return toast('ช่วงเวลาไม่ถูกต้อง', 'เวลาเปิดรับราคาต้องมาก่อนเวลาปิดรับ', 'crit')
    setBusy(true)
    try {
      const id = await createTender({
        title: f.title.trim(),
        description: f.type === 'sealed'
          ? 'ประมูลแบบปิดซอง — ปรับราคาได้จนหมดเวลา ไม่มีใครเห็นราคาของกัน เปิดซองพร้อมกันทีเดียว'
          : 'ประมูลแบบเปิด — เห็นราคาคู่แข่งเรียลไทม์ ปรับราคาได้จนหมดเวลา',
        type: f.type,
        budget: Number(f.budget),
        target_price: f.target_price === '' ? null : Number(f.target_price),
        remark: f.remark.trim(),
        opens_at: new Date(f.opens_at).toISOString(),
        closes_at: new Date(f.closes_at).toISOString(),
        items: items.map(i => ({ name: i.name.trim(), spec: i.spec.trim() || '—', qty: Number(i.qty), unit: i.unit.trim() || 'ชิ้น' })),
        required_docs: f.docs.split('\n').map(s => s.trim()).filter(Boolean),
        invited,
      })
      if (files.length) await uploadTenderFiles(id, files)   // อัปโหลดหลังได้ tender id

      // ถ้าฐานข้อมูลยังไม่ได้รัน 14_open_period.sql มันจะเมินเวลาเปิดที่กรอกแล้วใช้ now() แทน
      // เงียบ ๆ โดยไม่ error — ต้องจับตรงนี้ ไม่งั้นประกาศจะเปิดรับทันทีทั้งที่ตั้งเวลาไว้
      const saved = await tenderTimes(id)
      const wanted = new Date(f.opens_at).getTime()
      if (saved && Math.abs(new Date(saved.opens_at).getTime() - wanted) > 3 * 60000) {
        clearDraft()
        toast('ประกาศแล้ว แต่เวลาเปิดรับไม่ถูกบันทึก',
          `ระบบบันทึกเป็น ${stamp(saved.opens_at)} แทน ${stamp(f.opens_at)} — ` +
          'ฐานข้อมูลยังไม่ได้ติดตั้ง 14_open_period.sql ให้ผู้ดูแลรันไฟล์นี้ใน SQL Editor แล้วสร้างประกาศใหม่', 'crit')
        onCreated(id)
        return
      }

      clearDraft()
      toast('ประกาศแล้ว', `แจ้งเตือนซัพพลายเออร์ ${invited.length} ราย`, 'good')
      onCreated(id)
    } catch (err) {
      toast('สร้างประกาศไม่สำเร็จ', err.message, 'crit')
    } finally { setBusy(false) }
  }

  return (
    <div className="scrim" onClick={e => { if (e.target.classList.contains('scrim')) onClose() }}>
      <form className="sheet" onSubmit={onSubmit}>
        <header><h2>สร้างประกาศเชิญประมูล</h2>
          <button type="button" className="btn ghost sm" onClick={onClose}>ปิด</button></header>

        {restored && (
          <div className="rule" style={{ margin: '0 1rem', borderLeftColor: 'var(--warn)',
                                         background: 'var(--warn-wash)' }}>
            <div className="spread" style={{ gap: '.6rem' }}>
              <span><b>กู้แบบร่างที่ค้างไว้มาให้แล้ว</b> — ที่พิมพ์ไว้ครั้งก่อนยังอยู่ครบ
                {draft?.at && ` (บันทึกเมื่อ ${stamp(draft.at)})`} ยกเว้นไฟล์แนบที่ต้องเลือกใหม่</span>
              <button type="button" className="btn sm" onClick={resetForm}>เริ่มใหม่ทั้งหมด</button>
            </div>
          </div>
        )}

        <div className="body">
          <label className="f"><span>ชื่องาน / รายการจัดซื้อ</span>
            <input type="text" required value={f.title} onChange={e => set('title', e.target.value)}
                   placeholder="เช่น กล่องกระดาษลูกฟูก 3 ชั้น ล็อต ต.ค." /></label>

          <div>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '.4rem' }}>รูปแบบการประมูล</span>
            <div className="seg">
              <label><input type="radio" name="ntype" checked={f.type === 'sealed'} onChange={() => set('type', 'sealed')} />
                <b>{ICON.lock} ปิดราคา</b><span className="dim">ไม่มีใครเห็นราคาของกัน ปรับราคาได้จนหมดเวลา เปิดซองพร้อมกันทีเดียว</span></label>
              <label><input type="radio" name="ntype" checked={f.type === 'open'} onChange={() => set('type', 'open')} />
                <b>{ICON.eye} เปิดราคา</b><span className="dim">เห็นราคาเรียลไทม์ ปรับราคาแข่งได้จนหมดเวลา</span></label>
            </div>
          </div>

          <label className="f"><span>งบประมาณ (บาท) — เห็นเฉพาะฝ่ายจัดซื้อ</span>
            <input type="number" min="0" className="num" required value={f.budget}
                   onChange={e => set('budget', e.target.value)} placeholder="1000000" /></label>

          <div>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '.4rem' }}>ช่วงเวลาประมูล</span>
            <div className="grid g2" style={{ gap: '.7rem' }}>
              <label className="f"><span>เปิดรับราคา</span>
                <input type="datetime-local" required value={f.opens_at}
                       onChange={e => set('opens_at', e.target.value)} /></label>
              <label className="f"><span>ปิดรับราคา</span>
                <input type="datetime-local" required value={f.closes_at}
                       onChange={e => set('closes_at', e.target.value)} /></label>
            </div>
            <p className="dim" style={{ marginTop: '.4rem' }}>
              ตั้งเวลาเปิดล่วงหน้าได้ — ผู้ขายจะเห็นประกาศและเอกสารก่อน แต่ยื่นราคาไม่ได้จนถึงเวลาเปิด
              (ระบบขึ้นสถานะ “ยังไม่เปิดรับ” และนับถอยหลังให้)
            </p>
          </div>

          <label className="f"><span>ราคาคาดหวัง (บาท) — เห็นเฉพาะฝ่ายจัดซื้อ</span>
            <input type="number" min="0" className="num" value={f.target_price}
                   onChange={e => set('target_price', e.target.value)} placeholder="เช่น 900000" /></label>
          <p className="dim" style={{ marginTop: '-.4rem' }}>
            รายที่เสนอต่ำสุดและถึงราคาคาดหวังจะได้สัญลักษณ์ค้อน หากมีรายอื่นเสนอต่ำกว่า ค้อนย้ายไปรายนั้นทันที
            ผู้ขายเห็นแค่ค้อน ไม่เห็นตัวเลขนี้ (บังคับด้วย RLS)
          </p>

          <div>
            <div className="spread" style={{ marginBottom: '.4rem' }}>
              <span className="eyebrow">รายการที่ต้องการ</span>
              <button type="button" className="btn sm"
                      onClick={() => setItems([...items, { name: '', spec: '', qty: '', unit: 'ชิ้น' }])}>
                {ICON.plus} เพิ่มรายการ</button>
            </div>
            <div className="stack" style={{ gap: '.5rem' }}>
              {items.map((it, i) => (
                <div className="card pad stack" key={i} style={{ gap: '.45rem', background: 'var(--surface-2)' }}>
                  <div className="row" style={{ gap: '.4rem' }}>
                    <input type="text" required placeholder="ชื่อรายการ" style={{ flex: 1 }} value={it.name}
                           onChange={e => setItems(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    {items.length > 1 && <button type="button" className="btn ghost sm danger"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}>ลบ</button>}
                  </div>
                  <input type="text" placeholder="สเปก / เงื่อนไข" value={it.spec}
                         onChange={e => setItems(items.map((x, j) => j === i ? { ...x, spec: e.target.value } : x))} />
                  <div className="row" style={{ gap: '.4rem' }}>
                    <input type="number" min="1" className="num" required placeholder="จำนวน" style={{ flex: 1 }} value={it.qty}
                           onChange={e => setItems(items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                    <input type="text" placeholder="หน่วย" style={{ width: 110 }} value={it.unit}
                           onChange={e => setItems(items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="spread" style={{ marginBottom: '.4rem' }}>
              <span className="eyebrow">เอกสารแนบส่งให้ซัพพลายเออร์</span>
              <span className="dim">{files.length} ไฟล์</span>
            </div>
            {files.length > 0 && (
              <div className="docs">
                {files.map((x, i) => (
                  <div className="doc" key={i}>
                    <span className="ext">{ext(x.name)}</span><span className="n">{x.name}</span>
                    <span className="dim num">{kb(x.size)}</span>
                    <button type="button" className="btn ghost sm"
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}>ลบ</button>
                  </div>
                ))}
              </div>
            )}
            <label className="drop" style={{ marginTop: '.5rem' }}>
              <input type="file" multiple style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                     onChange={e => { setFiles([...files, ...e.target.files]); e.target.value = '' }} />
              <b style={{ fontFamily: 'var(--font-d)' }}>แนบ TOR / สเปก / แบบ / แบบฟอร์มใบเสนอราคา</b>
              <span className="dim" style={{ display: 'block' }}>ผู้ถูกเชิญทุกรายเห็นและดาวน์โหลดได้ทันทีที่ประกาศ</span>
            </label>
          </div>

          <label className="f"><span>หมายเหตุถึงผู้ขาย (ไม่บังคับ)</span>
            <textarea value={f.remark} maxLength={2000} rows={3}
                      onChange={e => set('remark', e.target.value)}
                      placeholder={'เช่น เงื่อนไขการชำระเงิน 30 วันหลังรับของ\n' +
                                   'ส่งมอบที่ DC บางบัวทอง จ–ศ 08:00–16:00\n' +
                                   'ราคารวมค่าขนส่งและภาษีแล้ว'} /></label>
          <p className="dim" style={{ marginTop: '-.4rem' }}>
            {ICON.eye} ผู้ขายที่ถูกเชิญทุกรายอ่านข้อความนี้ได้ —
            <b> ห้ามใส่งบประมาณหรือราคาคาดหวัง</b> ({f.remark.length}/2000)
          </p>

          <label className="f"><span>เอกสารที่ซัพพลายเออร์ต้องแนบกลับ (บรรทัดละ 1 รายการ)</span>
            <textarea value={f.docs} onChange={e => set('docs', e.target.value)} /></label>
          <p className="dim" style={{ marginTop: '-.4rem' }}>
            ยิ่งขอเอกสารน้อย ผู้ขายยิ่งยื่นราคาง่าย — ระบบจะบอกผู้ขายเองว่า “{SPEC_NOTE}”
          </p>

          <div>
            <div className="spread" style={{ marginBottom: '.4rem' }}>
              <span className="eyebrow">เชิญซัพพลายเออร์ ({invited.length}/{suppliers.length})</span>
              <span className="row" style={{ gap: '.35rem' }}>
                <button type="button" className="btn ghost sm"
                        disabled={invited.length === suppliers.length}
                        onClick={() => setInvited(suppliers.map(s => s.id))}>เลือกทั้งหมด</button>
                <button type="button" className="btn ghost sm"
                        disabled={invited.length === 0}
                        onClick={() => setInvited([])}>เอาออกทั้งหมด</button>
              </span>
            </div>
            <div className="checks">
              {suppliers.map(s => (
                <label key={s.id}>
                  <input type="checkbox" checked={invited.includes(s.id)}
                         onChange={e => setInvited(e.target.checked ? [...invited, s.id] : invited.filter(x => x !== s.id))} />
                  {s.name} <span className="dim">{s.code}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer>
          <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'กำลังประกาศ…' : 'ประกาศเชิญประมูล'}</button>
        </footer>
      </form>
    </div>
  )
}

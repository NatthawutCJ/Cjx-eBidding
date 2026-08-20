import { useState } from 'react'
import { createTender, uploadTenderFiles } from '../lib/api'
import { ext, kb } from '../lib/format'
import { ICON, toast } from './bits'

const DEFAULT_DOCS = ['ใบเสนอราคาลงนาม (PDF)', 'หนังสือรับรองบริษัท', 'ภ.พ.20 / ทะเบียนภาษี']
const localDefault = () => {
  const d = new Date(Date.now() + 3 * 86400000); d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function CreateTender({ suppliers, onClose, onCreated }) {
  const [f, setF] = useState({
    title: '', type: 'sealed', budget: '', target_price: '',
    closes_at: localDefault(), docs: DEFAULT_DOCS.join('\n'),
  })
  const [items, setItems] = useState([{ name: '', spec: '', qty: '', unit: 'ชิ้น' }])
  const [invited, setInvited] = useState(suppliers.map(s => s.id))
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF({ ...f, [k]: v })

  async function onSubmit(e) {
    e.preventDefault()
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
        closes_at: new Date(f.closes_at).toISOString(),
        items: items.map(i => ({ name: i.name.trim(), spec: i.spec.trim() || '—', qty: Number(i.qty), unit: i.unit.trim() || 'ชิ้น' })),
        required_docs: f.docs.split('\n').map(s => s.trim()).filter(Boolean),
        invited,
      })
      if (files.length) await uploadTenderFiles(id, files)   // อัปโหลดหลังได้ tender id
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

          <div className="grid g2" style={{ gap: '.7rem' }}>
            <label className="f"><span>งบประมาณ (บาท)</span>
              <input type="number" min="0" className="num" required value={f.budget}
                     onChange={e => set('budget', e.target.value)} placeholder="1000000" /></label>
            <label className="f"><span>ปิดรับราคา</span>
              <input type="datetime-local" required value={f.closes_at}
                     onChange={e => set('closes_at', e.target.value)} /></label>
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

          <label className="f"><span>เอกสารที่ซัพพลายเออร์ต้องแนบกลับ (บรรทัดละ 1 รายการ)</span>
            <textarea value={f.docs} onChange={e => set('docs', e.target.value)} /></label>

          <div>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '.4rem' }}>เชิญซัพพลายเออร์</span>
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

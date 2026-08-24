// ---------- ดาวน์โหลดข้อมูลเป็นไฟล์ CSV ----------
// ใส่ BOM (﻿) เสมอ ไม่งั้น Excel บน Windows จะอ่านภาษาไทยเป็นตัวขยะ
const esc = v => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCSV(rows) {
  return rows.map(r => r.map(esc).join(',')).join('\r\n')
}

export function downloadCSV(filename, rows) {
  const blob = new Blob(['﻿' + toCSV(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const d = ts => (ts ? new Date(ts).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '')

// ---------- ใบเปรียบเทียบราคาของงานเดียว ----------
export function tenderComparisonRows(t) {
  const bids = [...t.bids].sort((a, b) => a.total - b.total)
  const rows = []
  rows.push(['ใบเปรียบเทียบราคา'])
  rows.push(['เลขที่ประกาศ', t.code])
  rows.push(['ชื่องาน', t.title])
  rows.push(['ประเภท', t.type === 'sealed' ? 'ปิดราคา' : 'เปิดราคา'])
  if (t.budget != null) rows.push(['งบประมาณ', t.budget])
  if (t.target_price != null) rows.push(['ราคาคาดหวัง (ภายใน)', t.target_price])
  rows.push(['ปิดรับราคา', d(t.closes_at)])
  if (t.unsealed_at) rows.push(['เปิดซอง', d(t.unsealed_at)])
  if (t.cancelled_at) rows.push(['ยกเลิกเมื่อ', d(t.cancelled_at), t.cancel_reason || ''])
  rows.push(['ออกรายงาน', d(Date.now())])
  rows.push([])

  // ตารางราคาต่อหน่วยรายรายการ
  rows.push(['รายการ', 'สเปก', 'จำนวน', 'หน่วย', ...bids.map(b => b.suppliers?.name || '-')])
  t.items.forEach(it => {
    rows.push([
      it.name, it.spec, it.qty, it.unit,
      ...bids.map(b => (b.bid_lines || []).find(l => l.item_id === it.id)?.unit_price ?? ''),
    ])
  })
  rows.push([])
  rows.push(['ราคารวม (บาท)', '', '', '', ...bids.map(b => b.total)])
  rows.push(['ส่วนต่างจากต่ำสุด', '', '', '',
    ...bids.map(b => (bids.length ? Number(b.total) - Number(bids[0].total) : 0))])
  if (t.budget != null) rows.push(['เทียบงบประมาณ (%)', '', '', '',
    ...bids.map(b => (((Number(b.total) - t.budget) / t.budget) * 100).toFixed(2))])
  rows.push([])
  rows.push(['ผู้เสนอราคา', 'รหัสผู้ขาย', 'ยื่นเมื่อ', 'แก้ไข (ครั้ง)', 'จำนวนเอกสาร', 'หมายเหตุ'])
  bids.forEach(b => rows.push([
    b.suppliers?.name || '-', b.suppliers?.code || '', d(b.submitted_at),
    b.version, (b.bid_files || []).length, b.note || '',
  ]))
  return rows
}

// ---------- รายการประมูลทั้งหมด ----------
export function tenderListRows(tenders, statusLabel) {
  // ไฟล์ของผู้ขายจะไม่มีคอลัมน์งบประมาณเลย (RLS ไม่ส่งค่ามาให้ตั้งแต่ต้น)
  const withBudget = tenders.some(t => t.budget != null)
  const rows = [[
    'เลขที่ประกาศ', 'ชื่องาน', 'ประเภท', 'สถานะ', ...(withBudget ? ['งบประมาณ'] : []),
    'จำนวนรายการ', 'ผู้ถูกเชิญ', 'ใบเสนอราคา', 'ปิดรับราคา', 'สร้างเมื่อ',
  ]]
  tenders.forEach(t => rows.push([
    t.code, t.title,
    t.type === 'sealed' ? 'ปิดราคา' : 'เปิดราคา',
    statusLabel(t),
    ...(withBudget ? [t.budget] : []),
    (t.items || []).length,
    (t.tender_invites || []).length,
    t.bid_count ?? '',
    d(t.closes_at), d(t.created_at),
  ]))
  return rows
}

// ---------- ประวัติการยื่นราคาของผู้ขาย ----------
export function myBidRows(tenders, statusLabel) {
  const rows = [['เลขที่ประกาศ', 'ชื่องาน', 'ประเภท', 'สถานะงาน', 'ราคาที่ยื่น', 'ผลการพิจารณา', 'ปิดรับราคา']]
  tenders.filter(t => t.my_bid).forEach(t => rows.push([
    t.code, t.title,
    t.type === 'sealed' ? 'ปิดราคา' : 'เปิดราคา',
    statusLabel(t),
    t.my_bid.total,
    t.my_bid_won ? 'ชนะ' : t.awarded_bid_id ? 'ไม่ได้รับเลือก' : 'รอผล',
    d(t.closes_at),
  ]))
  return rows
}

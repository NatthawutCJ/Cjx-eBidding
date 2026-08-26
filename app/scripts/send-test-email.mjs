#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ส่งอีเมลตัวอย่างผ่าน Resend (ต้นแบบ)
//
//   ดูก่อนโดยไม่ต้องมีคีย์:   node scripts/send-test-email.mjs welcome --dry-run
//   ส่งจริง:                  RESEND_API_KEY=re_xxxxxxxxxxxx node scripts/send-test-email.mjs welcome you@cjmart.co.th
//
// แม่แบบใช้ <table> กับ inline CSS ล้วน ไม่ใช้ flex/grid เพราะ Outlook บนเดสก์ท็อป
// เรนเดอร์ด้วยเอนจินของ Word ซึ่งไม่รู้จัก layout สมัยใหม่
//
// ที่อยู่ผู้ส่ง:
//   ก่อน IT ยืนยันโดเมน — onboarding@resend.dev (ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend)
//   หลังยืนยันโดเมนแล้ว  — MAIL_FROM="ฝ่ายจัดซื้อกลาง CJx <noreply.snp@cjmart.co.th>"
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs'

const API   = 'https://api.resend.com/emails'
const FROM  = process.env.MAIL_FROM || 'CJx e-Bidding (ทดสอบ) <onboarding@resend.dev>'
const APP   = process.env.APP_URL   || 'https://cjx-ebidding.pages.dev'
const REPLY = process.env.MAIL_REPLY_TO || 'procurement@cjmart.co.th'

// ---------- ข้อมูลตัวอย่าง แก้ตรงนี้เพื่อลองเนื้อหาอื่น ----------
const SAMPLE = {
  contact: 'Chatnapa',
  company: 'Buum Company',
  vendorCode: 'V-1001',
  loginEmail: 'chatnapa.ton@cjmart.co.th',
  buyer: 'Natthawut · ฝ่ายจัดซื้อกลาง',
  rfq: 'RFQ_2026_08_022',
  title: 'กล่องกระดาษลูกฟูก 3 ชั้น — ล็อต ต.ค. 69',
  type: 'ปิดราคา',
  closesAt: '22 Aug 26 16:00',
  closesIn: 'ปิดรับใน 3 วัน',
  unsealAt: '22 Aug 26 16:30',
  validity: 'ไม่น้อยกว่า 30 วัน',
  delivery: 'ศูนย์กระจายสินค้าบางบัวทอง',
  items: [
    ['กล่องลูกฟูก 3 ชั้น 40×30×20 ซม.', 'พิมพ์ 1 สี โลโก้ตามแบบแนบ', '8,000 ใบ'],
    ['กล่องลูกฟูก 3 ชั้น 60×40×30 ซม.', 'พิมพ์ 1 สี โลโก้ตามแบบแนบ', '4,000 ใบ'],
  ],
  buyerFiles: [
    ['PDF',  'TOR_กล่องลูกฟูก_2609.pdf', '627 KB'],
    ['XLSX', 'แบบฟอร์มใบเสนอราคา.xlsx', '72 KB'],
  ],
  docs: ['ใบเสนอราคาลงนาม (PDF)', 'หนังสือรับรองบริษัท', 'ภ.พ.20 / ทะเบียนภาษี'],
}

// ---------- ชิ้นส่วนที่ใช้ร่วมกัน ----------
// เหลือง = แถบหัวจดหมาย · เขียว = เส้นคาดและป้าย (สุ่มค่าจากไฟล์โลโก้: เขียว #45905 2 แดง #D14948)
const YEL = '#E9C84A', GRN = '#42904E', INK = '#141b2d', DIM = '#5b6478', LINE = '#e2e5ec'
const WASH = '#eef4ee', SOFT = '#f7f8fa'
const FONT = "-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Thai',sans-serif"

const esc = v => String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

// ป้ายเล็ก ๆ เรียงแนวนอน — ใช้ตารางแทน inline-block เพราะ Outlook ไม่จัดระยะให้
const chips = list => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    ${list.map(([text, solid]) => `
    <td style="padding-right:6px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="${solid ? GRN : WASH}" style="border-radius:5px;padding:4px 9px;font-family:${FONT};
          font-size:11px;font-weight:700;color:${solid ? '#ffffff' : GRN};white-space:nowrap">${esc(text)}</td>
    </tr></table></td>`).join('')}
  </tr></table>`

const eyebrow = t => `<div style="font-family:${FONT};font-size:11px;font-weight:700;color:${DIM};
  letter-spacing:.06em;text-transform:uppercase;padding:22px 0 8px">${esc(t)}</div>`

// ปุ่มหลักเต็มความกว้างเพื่อให้กดง่ายบนมือถือ ปุ่มรองเป็นขอบบาง
const button = (label, href, kind = 'primary') => kind === 'primary' ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px">
    <tr><td align="center" bgcolor="${YEL}" style="border-radius:8px">
      <a href="${href}" style="display:block;padding:14px 20px;font-family:${FONT};font-size:15px;
         font-weight:700;color:${INK};text-decoration:none">${esc(label)}</a>
    </td></tr>
  </table>` : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px">
    <tr><td align="center" bgcolor="#ffffff" style="border-radius:8px;border:1px solid ${LINE}">
      <a href="${href}" style="display:block;padding:12px 20px;font-family:${FONT};font-size:14px;
         font-weight:600;color:${DIM};text-decoration:none">${esc(label)}</a>
    </td></tr>
  </table>`

const rows = pairs => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${LINE};border-radius:8px;background:#fcfcfd">
    <tr><td style="padding:6px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kv">
      ${pairs.map(([k, v], i) => `
      <tr>
        <td class="k" style="padding:9px 0;font-family:${FONT};font-size:13px;color:${DIM};width:150px;
            vertical-align:top;${i ? `border-top:1px solid ${LINE}` : ''}">${esc(k)}</td>
        <td class="v" style="padding:9px 0;font-family:${FONT};font-size:14px;color:${INK};
            vertical-align:top;${i ? `border-top:1px solid ${LINE}` : ''}">${v}</td>
      </tr>`).join('')}
      </table>
    </td></tr>
  </table>`

// ตารางรายการที่ต้องเสนอราคา
const itemsTable = items => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${LINE};border-radius:8px;border-collapse:separate">
    <tr>
      <td style="padding:9px 12px;background:${SOFT};font-family:${FONT};font-size:11px;font-weight:700;
          color:${DIM};letter-spacing:.04em;border-bottom:1px solid ${LINE}">รายการ</td>
      <td align="right" style="padding:9px 12px;background:${SOFT};font-family:${FONT};font-size:11px;
          font-weight:700;color:${DIM};letter-spacing:.04em;border-bottom:1px solid ${LINE};
          white-space:nowrap">จำนวน</td>
    </tr>
    ${items.map(([name, spec, qty], i) => `
    <tr>
      <td style="padding:10px 12px;font-family:${FONT};font-size:14px;color:${INK};
          ${i ? `border-top:1px solid ${LINE}` : ''}">
        ${esc(name)}<br><span style="font-size:12px;color:${DIM}">${esc(spec)}</span></td>
      <td align="right" style="padding:10px 12px;font-family:${FONT};font-size:14px;font-weight:600;
          color:${INK};white-space:nowrap;vertical-align:top;${i ? `border-top:1px solid ${LINE}` : ''}">
        ${esc(qty)}</td>
    </tr>`).join('')}
  </table>`

// ไฟล์แนบจากผู้ซื้อ — โชว์ชื่อไฟล์อย่างเดียว ไม่แนบไฟล์จริงมากับอีเมล
const fileList = files => files.map(([kind, name, size]) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin-bottom:6px"><tr>
    <td width="46" style="padding:9px 0 9px 10px;vertical-align:middle">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${SOFT}" style="border:1px solid ${LINE};border-radius:4px;padding:3px 6px;
            font-family:${FONT};font-size:10px;font-weight:700;color:${DIM}">${esc(kind)}</td>
      </tr></table></td>
    <td style="padding:9px 10px 9px 8px;font-family:${FONT};font-size:13px;color:${INK};vertical-align:middle">
      ${esc(name)} <span style="color:${DIM}">· ${esc(size)}</span></td>
  </tr></table>`).join('')

const checklist = list => list.map(t => `
  <div style="font-family:${FONT};font-size:14px;color:${INK};padding:5px 0 5px 18px;
       border-left:2px solid ${GRN}">${esc(t)}</div>`).join('')

const note = html => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px">
    <tr><td bgcolor="${SOFT}" style="border-left:3px solid ${GRN};border-radius:0 8px 8px 0;padding:12px 14px;
        font-family:${FONT};font-size:13px;color:${DIM};line-height:1.75">${html}</td></tr>
  </table>`

// preheader = ข้อความตัวอย่างที่โผล่ต่อจากหัวเรื่องในกล่องจดหมาย ซ่อนไม่ให้เห็นในตัวอีเมล
const shell = (preheader, inner) => `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<!-- กันไคลเอนต์ทำอีเมล/เบอร์เป็นลิงก์สีฟ้าเอง (Apple Mail ทำเป็นค่าเริ่มต้น) -->
<meta name="format-detection" content="telephone=no,email=no,address=no">
<style>
  /* จอแคบ: ตารางกว้าง 600 ย่อลงไม่ได้เอง (ตาราง HTML ย่อต่ำกว่าความกว้างขั้นต่ำของเนื้อหาไม่ได้)
     จึงต้องสั่งให้คอลัมน์ซ้าย-ขวาเรียงลงมาแทน  Outlook เดสก์ท็อปไม่อ่าน media query
     แต่ที่นั่นจอกว้างพออยู่แล้ว จึงใช้ 600 ตามเดิม */
  @media only screen and (max-width:620px){
    .wrap{width:100%!important}
    .kv td{display:block!important;width:100%!important}
    .kv td.k{padding:10px 0 0!important;border:0!important}
    .kv td.v{padding:2px 0 10px!important}
  }
</style></head>
<body style="margin:0;padding:0;background:#f4f5f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f8">
 <tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap"
         style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:12px">
   <tr><td style="padding:18px 28px;background:${YEL};border-bottom:3px solid ${GRN};border-radius:12px 12px 0 0">
     <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
       <td style="padding-right:12px;vertical-align:middle">
         <img src="${APP}/cjx-logo.png" alt="CJx" height="36"
              style="display:block;height:36px;width:auto;border:0">
       </td>
       <td style="vertical-align:middle">
         <div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK}">ระบบประมูลจัดซื้อ CJx</div>
         <div style="font-family:${FONT};font-size:12px;color:#6b5d1f;padding-top:2px">Supplier e-Bidding Portal</div>
       </td>
     </tr></table>
   </td></tr>
   <tr><td style="padding:26px 28px 28px">${inner}</td></tr>
   <tr><td style="padding:16px 28px;border-top:1px solid ${LINE};background:#fafbfc;border-radius:0 0 12px 12px">
     <div style="font-family:${FONT};font-size:12px;color:${DIM};line-height:1.7">
       CJx <b>ไม่มีนโยบายเรียกเก็บค่าธรรมเนียม</b>ในการเข้าร่วมประมูล และ<b>ไม่เคยขอรหัสผ่าน</b>ของท่าน
       ทางอีเมลหรือโทรศัพท์ หากพบข้อความลักษณะดังกล่าว กรุณาแจ้ง ${REPLY} ทันที<br><br>
       สอบถามการใช้งาน: ${REPLY} · จ–ศ 08:30–17:30<br>
       อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับที่อยู่ผู้ส่ง
     </div>
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`

// ---------- ฉบับที่ 1: เปิดบัญชีผู้ขาย ----------
const welcome = d => ({
  subject: 'เชิญเปิดบัญชีผู้ขาย — ระบบประมูลจัดซื้อ CJx',
  html: shell(`${d.company} ได้รับการขึ้นทะเบียนเป็นผู้ขายของ CJx แล้ว`, `
    <div style="font-family:${FONT};font-size:21px;font-weight:700;color:${INK};padding-bottom:10px">
      เปิดบัญชีเพื่อเข้าร่วมประมูลกับ CJx</div>
    <div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.75">
      สวัสดีครับ คุณ ${esc(d.contact)}<br><br>
      <b>${esc(d.company)}</b> ได้รับการขึ้นทะเบียนเป็นผู้ขายของ CJx เรียบร้อยแล้ว
      ระบบนี้ใช้สำหรับรับประกาศเชิญประมูล เสนอราคา และส่งเอกสารประกอบ
    </div>
    <div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.75;padding:14px 0 20px">
      <b>รหัสผ่านชั่วคราว</b> ฝ่ายจัดซื้อจะแจ้งท่านทางโทรศัพท์หรือ LINE แยกจากอีเมลฉบับนี้ เพื่อความปลอดภัย
      และเมื่อเข้าระบบครั้งแรก <b>ระบบจะให้ท่านตั้งรหัสผ่านใหม่ของท่านเองทันที</b> ฝ่ายจัดซื้อจะไม่ทราบรหัสใหม่นั้น
    </div>
    ${rows([
      ['รหัสผู้ขาย', esc(d.vendorCode)],
      ['อีเมลเข้าระบบ', esc(d.loginEmail)],
      ['รหัสผ่านชั่วคราว', 'แจ้งทางโทรศัพท์/LINE แยกจากอีเมลฉบับนี้'],
      ['ผู้ดูแลบัญชีของคุณ', esc(d.buyer)],
    ])}
    <div style="padding-top:22px">${button('เข้าสู่ระบบครั้งแรก', APP)}</div>
    <div style="font-family:${FONT};font-size:13px;color:${DIM};line-height:1.75">
      หากรหัสชั่วคราวใช้ไม่ได้ หรือลืมรหัสภายหลัง กด <b style="color:${INK}">“ลืมรหัสผ่าน”</b>
      ที่หน้าเข้าสู่ระบบ ระบบจะส่งลิงก์ตั้งรหัสใหม่ให้ทางอีเมลนี้ ใช้ได้ครั้งเดียว
    </div>
    ${eyebrow('สิ่งที่ควรทราบ')}
    ${checklist([
      'หนึ่งบริษัทหนึ่งบัญชีหลัก และเพิ่มผู้ใช้ในบริษัทของท่านเองได้',
      'งานประเภท “ปิดราคา” ไม่มีผู้ใดเห็นราคาของท่านจนถึงเวลาเปิดซอง แต่ปรับราคาได้ไม่จำกัดจนหมดเวลา',
      'ท่านเห็นเฉพาะงานที่ได้รับเชิญ และเห็นเฉพาะใบเสนอราคาของบริษัทท่านเอง',
    ])}`),
})

// ---------- ฉบับที่ 2: เชิญเข้าร่วมประมูล ----------
const invite = d => ({
  subject: `[เชิญประมูล] ${d.rfq} ${d.title} — ปิดรับ ${d.closesAt}`,
  html: shell(`${d.company} ได้รับเชิญเสนอราคา ปิดรับ ${d.closesAt}`, `
    ${chips([[d.type, true], [d.closesIn, false]])}
    <div style="font-family:${FONT};font-size:12px;font-weight:700;color:${GRN};
        letter-spacing:.05em;padding:14px 0 2px">${esc(d.rfq)}</div>
    <div style="font-family:${FONT};font-size:21px;font-weight:700;color:${INK};padding-bottom:10px">
      ${esc(d.title)}</div>
    <div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.75">
      CJx ขอเชิญ <b>${esc(d.company)}</b> เข้าร่วมเสนอราคาในงานจัดซื้อดังรายละเอียดด้านล่าง
      กรุณายื่นใบเสนอราคาผ่านระบบก่อนเวลาปิดรับ
    </div>
    ${eyebrow('เงื่อนไขการประมูล')}
    ${rows([
      ['รูปแบบ', `${esc(d.type)} — ไม่มีผู้ใดเห็นราคาของกัน แต่ปรับราคาได้ไม่จำกัดจนหมดเวลา`],
      ['ปิดรับราคา', `<b>${esc(d.closesAt)}</b> (ตามเวลาระบบ)`],
      ['เปิดซอง', `${esc(d.unsealAt)} พร้อมกันทุกราย`],
      ['ยืนราคา', esc(d.validity)],
      ['ส่งมอบ', esc(d.delivery)],
    ])}
    ${eyebrow('รายการที่ต้องเสนอราคา')}
    ${itemsTable(d.items)}
    ${eyebrow('เอกสารประกอบจากผู้ซื้อ')}
    ${fileList(d.buyerFiles)}
    <div style="font-family:${FONT};font-size:12px;color:${DIM};padding-top:4px">
      ดาวน์โหลดได้ในระบบหลังเข้าสู่ระบบ — ไม่แนบไฟล์มากับอีเมลเพื่อความปลอดภัยของข้อมูล</div>
    ${eyebrow(`เอกสารที่ต้องส่งภายใน 3 วันหลังปิดประมูล`)}
    ${checklist(d.docs)}
    <div style="padding-top:22px">
      ${button('เข้าดูประกาศและยื่นราคา', APP)}${button('ขอสละสิทธิ์ในงานนี้', APP, 'ghost')}
    </div>
    ${note(`<b style="color:${INK}">ช่วงประมูลยังไม่ต้องแนบเอกสาร</b> ให้เน้นเสนอราคาก่อน
      เมื่อปิดประมูลแล้วระบบจะเปิดให้ส่งเอกสารภายใน 3 วัน`)}`),
})

// ---------- ตัวรัน ----------
const TEMPLATES = { welcome, invite }

const [kind, ...rest] = process.argv.slice(2)
const dryRun = rest.includes('--dry-run')
const to = rest.find(a => a.includes('@'))

// ตัดช่องว่าง/บรรทัดใหม่ที่มักติดมาตอนคัดลอกคีย์
const key = (process.env.RESEND_API_KEY || '').trim()

// อธิบายคีย์โดยไม่เปิดเผยตัวคีย์ ใช้ตอนหาสาเหตุ 401
const describeKey = () => key
  ? `ยาว ${key.length} ตัวอักษร ขึ้นต้น ${key.slice(0, 6)}… ลงท้าย …${key.slice(-4)}`
  : 'ไม่มีค่า'

const keyHelp = () => {
  console.error('\nคีย์ที่ตั้งไว้: ' + describeKey())
  console.error('เช็กทีละข้อ:')
  console.error('  1) คีย์จริงของ Resend ขึ้นต้นด้วย re_ และยาวราว 36 ตัวอักษร')
  console.error('     ถ้าสั้นกว่านั้นแปลว่าคัดลอกมาจากหน้ารายการคีย์ ซึ่งโชว์แค่บางส่วน')
  console.error('     Resend โชว์คีย์เต็มครั้งเดียวตอนกดสร้าง ถ้าพลาดให้สร้างใหม่แล้วคัดลอกทันที')
  console.error('  2) ครอบด้วยเครื่องหมายคำพูดเสมอ:  export RESEND_API_KEY="re_xxxxx"')
  console.error('  3) ตรวจว่าคีย์ใช้ได้จริง:  node scripts/send-test-email.mjs check')
}

// ---------- ตรวจคีย์อย่างเดียว ไม่ส่งอีเมล ----------
if (kind === 'check') {
  if (!key) { console.error('ยังไม่ได้ตั้ง RESEND_API_KEY'); process.exit(1) }
  const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    console.error(`คีย์ใช้ไม่ได้ (HTTP ${r.status}): ${j.message || JSON.stringify(j)}`)
    keyHelp()
    process.exit(1)
  }
  console.log('คีย์ใช้ได้ ✓ (' + describeKey() + ')')
  const list = j.data || []
  console.log(list.length
    ? 'โดเมนในบัญชีนี้:\n' + list.map(d => `  ${d.name} — ${d.status}`).join('\n')
    : 'ยังไม่มีโดเมนในบัญชี — ส่งได้เฉพาะจาก onboarding@resend.dev ถึงอีเมลเจ้าของบัญชีเท่านั้น')
  process.exit(0)
}

if (!TEMPLATES[kind]) {
  console.error(`ใช้: node scripts/send-test-email.mjs <${Object.keys(TEMPLATES).join('|')}|check> <อีเมลผู้รับ> [--dry-run]`)
  process.exit(1)
}

if (!process.env.APP_URL) {
  console.warn(`เตือน: ไม่ได้ตั้ง APP_URL จึงใช้ค่าเดา ${APP}`)
  console.warn('       ปุ่มในอีเมลและรูปโลโก้จะชี้ไปที่นี่ ถ้าไม่ใช่ URL จริงของเว็บ โลโก้จะไม่ขึ้น')
  console.warn('       ตั้งให้ถูกด้วย  export APP_URL="https://<ชื่อโปรเจกต์>.pages.dev"\n')
}

const mail = TEMPLATES[kind](SAMPLE)

if (dryRun) {
  const file = `preview-${kind}.html`
  writeFileSync(file, mail.html)
  console.log(`หัวเรื่อง: ${mail.subject}`)
  console.log(`เขียนไฟล์ตัวอย่างแล้ว: ${file} — เปิดด้วยเบราว์เซอร์เพื่อดูหน้าตา (ยังไม่ได้ส่งอีเมล)`)
  process.exit(0)
}

if (!key) {
  console.error('ไม่พบ RESEND_API_KEY — ตั้งค่าก่อน เช่น  export RESEND_API_KEY=re_xxxxx')
  console.error('หรือดูหน้าตาอีเมลก่อนโดยไม่ต้องส่ง:  node scripts/send-test-email.mjs ' + kind + ' --dry-run')
  process.exit(1)
}
if (!to) {
  console.error('ต้องระบุอีเมลผู้รับ เช่น  node scripts/send-test-email.mjs ' + kind + ' you@cjmart.co.th')
  process.exit(1)
}

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY, subject: mail.subject, html: mail.html }),
})
const out = await res.json().catch(() => ({}))

if (!res.ok) {
  console.error(`ส่งไม่สำเร็จ (HTTP ${res.status}): ${out.message || JSON.stringify(out)}`)
  if (res.status === 401) keyHelp()
  if (/domain is not verified|only send testing emails/i.test(out.message || '')) {
    console.error('→ ที่อยู่ผู้ส่ง onboarding@resend.dev ส่งได้เฉพาะอีเมลที่ใช้สมัครบัญชี Resend เท่านั้น')
    console.error('  ถ้าจะส่งหาคนอื่น ต้องให้ IT ยืนยันโดเมน cjmart.co.th ใน Resend ก่อน')
  }
  process.exit(1)
}

console.log(`ส่งแล้ว → ${to}`)
console.log(`หัวเรื่อง: ${mail.subject}`)
console.log(`id: ${out.id}`)

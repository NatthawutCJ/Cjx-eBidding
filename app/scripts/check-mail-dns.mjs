#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ตรวจว่า DNS สำหรับส่งอีเมลในนาม noreply.snp@cjmart.co.th พร้อมหรือยัง
//
//   node scripts/check-mail-dns.mjs
//   node scripts/check-mail-dns.mjs snp.cjmart.co.th      (กรณีใช้ subdomain แทน)
//
// ใช้ตอน IT แจ้งว่า "เพิ่ม record ให้แล้ว" เพื่อดูว่าขึ้นจริงหรือยัง
// โดยไม่ต้องเดาจากหน้า Resend (DNS ใช้เวลากระจาย 15 นาที – 72 ชม.)
// ---------------------------------------------------------------------------

import { Resolver } from 'node:dns/promises'

const domain = process.argv[2] || 'cjmart.co.th'
const r = new Resolver()
r.setServers(['1.1.1.1', '8.8.8.8'])   // ถาม DNS สาธารณะ ไม่ใช้แคชของเครื่อง

const get = async (fn, name) => { try { return await r[fn](name) } catch { return [] } }
const txt = async name => (await get('resolveTxt', name)).map(a => a.join(''))

const line = (ok, label, detail) =>
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(34)} ${detail}`)

console.log(`ตรวจ DNS ของ ${domain}\n`)

// ---------- 1) ของเดิมที่ต้องไม่ถูกแตะ ----------
const rootTxt = await txt(domain)
const spf = rootTxt.find(t => t.startsWith('v=spf1'))
line(!!spf, 'SPF ของโดเมนหลัก', spf || 'ไม่พบ')
if (spf && !/include:spf\.protection\.outlook\.com/.test(spf))
  console.log('   ⚠️  SPF ไม่มี Outlook อยู่แล้ว — ผิดปกติ ให้ IT ตรวจ อีเมลบริษัทอาจส่งไม่ออก')
if (spf && /sendgrid|amazonses|resend/i.test(spf))
  console.log('   ⚠️  มีผู้ให้บริการภายนอกอยู่ใน SPF ของโดเมนหลัก — วิธี CNAME ไม่จำเป็นต้องแก้ตรงนี้')

const dmarc = (await txt(`_dmarc.${domain}`))[0]
line(!!dmarc, 'DMARC', dmarc || 'ไม่พบ')
if (dmarc && /p=(quarantine|reject)/.test(dmarc))
  console.log('   หมายเหตุ: นโยบายเข้มอยู่ — ถ้ายังไม่ยืนยันโดเมน อีเมลจะเข้า junk ทันที')

// ---------- 2) ของใหม่ที่ Resend ต้องใช้ ----------
console.log()
const sub = `send.${domain}`
const sendMx = await get('resolveMx', sub)
line(sendMx.length > 0, `MX ของ ${sub}`,
  sendMx.map(m => `${m.priority} ${m.exchange}`).join(', ') || 'ไม่พบ — return-path ยังไม่พร้อม')

const sendTxt = await txt(sub)
const sendSpf = sendTxt.find(t => t.startsWith('v=spf1'))
line(!!sendSpf, `SPF ของ ${sub}`, sendSpf || 'ไม่พบ')

// DKIM ของ Resend เป็นได้ทั้ง TXT ตรง ๆ หรือ CNAME ชี้ไปที่ Resend
const dk = `resend._domainkey.${domain}`
const dkTxt = await txt(dk)
const dkCname = await get('resolveCname', dk)
const dkOk = dkTxt.length > 0 || dkCname.length > 0
line(dkOk, 'DKIM (resend._domainkey)',
  dkTxt.length ? `TXT ยาว ${dkTxt[0].length} ตัวอักษร`
  : dkCname.length ? `CNAME → ${dkCname[0]}`
  : 'ไม่พบ — นี่คือตัวที่ทำให้ผ่าน DMARC ขาดไม่ได้')

// ---------- สรุป ----------
const ready = sendMx.length > 0 && !!sendSpf && dkOk
console.log()
if (ready) {
  console.log('พร้อมแล้ว → กด Verify DNS Records ในหน้า Domains ของ Resend')
  console.log('เสร็จแล้วส่งทดสอบด้วย:')
  console.log(`  MAIL_FROM="ฝ่ายจัดซื้อกลาง CJx <noreply.snp@${domain}>" \\`)
  console.log('    node scripts/send-test-email.mjs invite อีเมลผู้รับ')
} else {
  console.log('ยังไม่พร้อม — ต้องให้ IT เพิ่ม record ที่ขึ้น ❌ ข้างบนก่อน')
  console.log('ค่าที่ต้องใช้ก็อปได้จาก resend.com → Domains → เลือกโดเมน (ค่า DKIM ไม่ซ้ำกับใคร)')
  console.log('DNS ใช้เวลากระจาย 15 นาที – 72 ชม. หลัง IT เพิ่มเสร็จ')
}

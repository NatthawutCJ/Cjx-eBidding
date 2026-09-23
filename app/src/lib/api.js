import { supabase } from './supabase'

// ============================ auth / profile ============================
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message === 'Invalid login credentials'
    ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : error.message)
}
export const signOut = () => supabase.auth.signOut()

// ---------- รหัสผ่าน ----------
// กันค้าง: ทุกคำสั่งมีเวลาจำกัด ถ้าเน็ตหลุดหรือ Supabase ไม่ตอบ จะขึ้น error ไม่ใช่หมุนค้าง
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(
    `${label} ไม่ตอบกลับใน ${ms/1000} วินาที — ลองกดรีเฟรชหน้าเว็บแบบล้างแคช (⌘⇧R) แล้วทำอีกครั้ง ` +
    `ถ้ายังไม่หายให้หยุด npm run dev แล้วสั่งใหม่`)), ms)),
])

// เปลี่ยนรหัสผ่านผ่านฟังก์ชันในฐานข้อมูล (09_self_password.sql)
// ไม่ใช้ supabase.auth.updateUser เพราะคำสั่งนั้นค้างในโปรเจกต์ที่ยังไม่ได้ต่อ SMTP
// ฟังก์ชันฝั่ง server ตรวจรหัสเดิมเองและเขียนรหัสใหม่แบบ bcrypt จึงเร็วและไม่ต้องพึ่งอีเมล
export async function changePassword(email, currentPassword, newPassword) {
  if (newPassword.length < 8) throw new Error('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร')
  if (newPassword === currentPassword) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม')

  console.info('[รหัสผ่าน] บันทึกรหัสใหม่')
  const { error } = await withTimeout(
    supabase.rpc('change_my_password', { p_current: currentPassword, p_new: newPassword }),
    12000, 'การบันทึกรหัสผ่าน')

  if (error) {
    const msg = error.message || String(error)
    if (/change_my_password/.test(msg) && /(does not exist|not find)/i.test(msg))
      throw new Error('ยังไม่ได้ติดตั้งฟังก์ชันเปลี่ยนรหัสผ่าน — ให้ผู้ดูแลรัน 09_self_password.sql ใน SQL Editor ก่อน')
    throw new Error(msg.replace(/^.*?ERROR:\s*/, ''))
  }
  return {}
}

// ตั้งรหัสใหม่จากลิงก์ในอีเมล (ไม่ต้องรู้รหัสเดิม)
export async function setNewPassword(newPassword) {
  if (newPassword.length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
  const { error } = await withTimeout(
    supabase.auth.updateUser({ password: newPassword }), 15000, 'การตั้งรหัสผ่าน')
  if (error) throw new Error('ตั้งรหัสผ่านไม่สำเร็จ: ' + error.message)
  try { await withTimeout(supabase.rpc('mark_password_changed'), 15000, 'การบันทึกสถานะ') } catch (_) {}
  return {}
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  })
  if (error) throw new Error(error.message)
}

// รับ user มาจาก onAuthStateChange ได้ เพื่อไม่ต้องเรียก getUser() (ซึ่งจะค้างถ้าถูกเรียกใน callback ของ auth)
export async function getProfile(passedUser) {
  const user = passedUser ?? (await supabase.auth.getUser()).data.user
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, position, supplier_id, must_change_password, password_changed_at, suppliers(id, code, name)')
    .eq('id', user.id).maybeSingle()
  if (error) throw error
  // บัญชีที่สร้างใน Authentication แล้วแต่ยังไม่ได้ผูกบริษัท (ไม่มีแถวใน profiles)
  if (!data) return { unlinked: true, id: user.id, email: user.email }
  return { ...data, email: user.email, org: data.suppliers?.name || 'ฝ่ายจัดซื้อกลาง' }
}

// ============================ tenders ============================
// ไม่มี budget ในนี้ — งบประมาณอยู่ตาราง tender_internal ที่ผู้ขายอ่านไม่ได้
//
// remark เป็นคอลัมน์ที่เพิ่มทีหลัง (16_remark.sql) ถ้าฐานข้อมูลยังไม่ได้รันไฟล์นั้น
// PostgREST จะตอบ "column tenders.remark does not exist" แล้วรายการประมูลหายทั้งหน้า
// จึงต้องถอยไปขอแบบไม่มีคอลัมน์นี้แทนการพังทั้งหน้า (เว็บกับฐานข้อมูลอัปเดตคนละจังหวะเสมอ)
let hasRemark = true
const tenderCols = () => `
  id, code, title, description, type,${hasRemark ? ' remark,' : ''} currency,
  opens_at, closes_at, unsealed_at, awarded_bid_id, awarded_at, created_at,
  tender_items(id, name, spec, qty, unit, sort),
  tender_invites(supplier_id, declined_at)`

const missingCol = e => e && /column .* does not exist/i.test(e.message || '')

// ยิง query แล้วถ้าเจอคอลัมน์ที่ยังไม่มีในฐานข้อมูล ให้ลองใหม่โดยตัดคอลัมน์นั้นออก
async function selectTender(build) {
  let res = await build(tenderCols())
  if (res.error && hasRemark && missingCol(res.error) && /remark/.test(res.error.message)) {
    console.warn('[ประกาศ] ฐานข้อมูลยังไม่มีคอลัมน์ remark — ข้ามไปก่อน (ให้ผู้ดูแลรัน 16_remark.sql)')
    hasRemark = false
    res = await build(tenderCols())
  }
  return res
}

export async function listTenders(supplierId) {
  const { data, error } = await selectTender(cols => supabase.from('tenders')
    .select(`${cols}, tender_events(id, kind, message, created_at)`)
    .order('closes_at', { ascending: false }))
  if (error) throw error
  const rows = data || []

  const [counts, hammers, myBids, internal] = await Promise.all([
    Promise.all(rows.map(t => supabase.rpc('tender_bid_count', { p_tender: t.id }))),
    Promise.all(rows.map(t => supabase.rpc('hammer_holder', { p_tender: t.id }))),
    supplierId
      ? supabase.from('bids').select('id, tender_id, total').eq('supplier_id', supplierId)
      : Promise.resolve({ data: [] }),
    // ผู้ขายจะได้ 0 แถวจาก RLS งบจึงเป็น null ในหน้าจอฝั่งผู้ขาย
    supabase.from('tender_internal').select('tender_id, budget'),
  ])
  const mine = Object.fromEntries((myBids.data || []).map(b => [b.tender_id, b]))
  const budgets = Object.fromEntries((internal.data || []).map(r => [r.tender_id, r.budget]))

  return rows.map((t, i) => ({
    ...t,
    budget: budgets[t.id] ?? null,
    items: (t.tender_items || []).sort((a, b) => a.sort - b.sort),
    events: (t.tender_events || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8),
    bid_count: counts[i].data ?? 0,
    hammer_supplier_id: hammers[i].data ?? null,
    my_bid: mine[t.id] || null,
    my_bid_won: !!(mine[t.id] && t.awarded_bid_id === mine[t.id].id),
  }))
}

export async function listSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('id, code, name').order('name')
  if (error) throw error
  return data || []
}

export async function getTender(id) {
  const [t, bids, events, count, hammer, myTarget, myHammer, internal] = await Promise.all([
    selectTender(cols => supabase.from('tenders').select(`${cols},
        tender_required_docs(id, label, sort),
        tender_files(id, file_name, file_path, size_bytes)`).eq('id', id).single()),
    supabase.from('bids').select(`id, supplier_id, total, note, version, submitted_at,
        bid_lines(item_id, unit_price),
        bid_files(id, file_name, file_path, size_bytes),
        suppliers(id, code, name)`).eq('tender_id', id).order('total', { ascending: true }),
    supabase.from('tender_events').select('*').eq('tender_id', id)
      .order('created_at', { ascending: false }).limit(30),
    supabase.rpc('tender_bid_count', { p_tender: id }),
    supabase.rpc('hammer_holder', { p_tender: id }),
    supabase.rpc('my_target_status', { p_tender: id }),
    supabase.rpc('my_hammer_state', { p_tender: id }),
    supabase.from('tender_internal').select('budget, target_price').eq('tender_id', id).maybeSingle(),
  ])
  if (t.error) throw t.error
  return {
    ...t.data,
    items: (t.data.tender_items || []).sort((a, b) => a.sort - b.sort),
    required_docs: (t.data.tender_required_docs || []).sort((a, b) => a.sort - b.sort),
    files: t.data.tender_files || [],
    bids: bids.data || [],            // RLS ตัดใบที่ยังไม่ควรเห็นออกให้แล้ว
    events: events.data || [],
    bid_count: count.data ?? 0,       // จำนวนจริง แม้ยังไม่เห็นราคา
    hammer_supplier_id: hammer.data ?? null,
    my_target_met: myTarget.data ?? null,      // true/false/null — ไม่มีตัวเลขเป้าติดมา
    my_hammer_state: myHammer.data ?? null,    // 'mine' | 'other' | 'none' | null
    budget: internal.data?.budget ?? null,               // null สำหรับผู้ขาย (RLS)
    target_price: internal.data?.target_price ?? null,   // null สำหรับผู้ขาย (RLS)
  }
}

// ============================ ไฟล์แนบ ============================
// ชื่อไฟล์ที่ใช้เป็น "คีย์" ใน Supabase Storage ต้องเป็น ASCII เท่านั้น
// ภาษาไทยหรืออักขระพิเศษจะโดนปฏิเสธด้วย error "Invalid key" (เจอจริงกับไฟล์ชื่อ "...บริษัท ซีเจ มาร์ท จำกัด.pdf")
// ชื่อจริงไม่หาย — เก็บไว้ในคอลัมน์ file_name ของฐานข้อมูล ใช้แสดงผลและตอนดาวน์โหลด
const rand = () => Math.random().toString(36).slice(2, 6)
const safe = name => {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^\w.\-]+/g, '-')     // \w = A-Z a-z 0-9 _ เท่านั้น (ไม่รวมไทย)
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return (base || 'file') + (ext ? '.' + ext : '')
}

export async function uploadBidFiles(tenderId, supplierId, files) {
  const out = []
  for (const f of files) {
    const path = `${tenderId}/${supplierId}/${Date.now()}-${rand()}-${safe(f.name)}`
    const { error } = await supabase.storage.from('bid-files').upload(path, f, { upsert: false })
    if (error) throw new Error(`อัปโหลด ${f.name} ไม่สำเร็จ: ${error.message}`)
    out.push({ file_name: f.name, file_path: path, size_bytes: f.size })
  }
  return out
}

export async function uploadTenderFiles(tenderId, files) {
  const rows = []
  for (const f of files) {
    const path = `${tenderId}/${Date.now()}-${rand()}-${safe(f.name)}`
    const { error } = await supabase.storage.from('tender-files').upload(path, f)
    if (error) throw new Error(`อัปโหลด ${f.name} ไม่สำเร็จ: ${error.message}`)
    rows.push({ tender_id: tenderId, file_name: f.name, file_path: path, size_bytes: f.size })
  }
  if (rows.length) {
    const { error } = await supabase.from('tender_files').insert(rows)
    if (error) throw error
  }
  return rows
}

export async function fileUrl(bucket, path, downloadAs) {
  // downloadAs = ชื่อไฟล์เดิมของผู้ใช้ (ภาษาไทยได้) ให้ดาวน์โหลดออกมาแล้วชื่อไม่เพี้ยน
  const opts = downloadAs ? { download: downloadAs } : undefined
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120, opts)
  if (error) throw new Error('เปิดไฟล์ไม่ได้: ' + error.message)
  return data.signedUrl
}

// ============================ actions (ผ่าน RPC ทั้งหมด) ============================
const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''))
  return data
}

export const submitBid   = (tenderId, lines, note, files) =>
  rpc('submit_bid', { p_tender: tenderId, p_lines: lines, p_note: note, p_files: files })
export const unsealTender = id      => rpc('unseal_tender', { p_tender: id })
export const awardBid     = bidId   => rpc('award_bid', { p_bid: bidId })
export const declineInvite = id     => rpc('decline_invite', { p_tender: id })
export const attachBidFiles = (tenderId, files) =>
  rpc('attach_bid_files', { p_tender: tenderId, p_files: files })
export const createTender = payload => rpc('create_tender', { p: payload })

// อ่านเวลาที่ฐานข้อมูลบันทึกจริง ใช้ตรวจว่า create_tender() รับค่า opens_at ไปหรือเปล่า
export async function tenderTimes(id) {
  const { data, error } = await supabase.from('tenders')
    .select('opens_at, closes_at').eq('id', id).maybeSingle()
  if (error) return null
  return data
}
export const cancelTender  = (id, reason) => rpc('cancel_tender', { p_tender: id, p_reason: reason })

// ลบประกาศ: เอาไฟล์ TOR ออกจาก storage ก่อน แล้วค่อยลบข้อมูล
// (ฐานข้อมูลลบแถวลูกให้เองด้วย cascade แต่ไฟล์ใน storage ไม่หายตาม)
export async function deleteTender(id, files = []) {
  const paths = files.map(f => f.file_path).filter(Boolean)
  if (paths.length) await supabase.storage.from('tender-files').remove(paths)
  return rpc('delete_tender', { p_tender: id })
}

// ============================ จัดการผู้ใช้ (ฝ่ายจัดซื้อ) ============================
export async function adminListUsers() {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw new Error(error.message)
  return data || []
}
export const adminSetSupplierPassword = (targetId, password) =>
  rpc('admin_set_supplier_password', { p_target: targetId, p_password: password })
export const adminSetMustChange = (targetId, value) =>
  rpc('admin_set_must_change', { p_target: targetId, p_value: value })

export async function adminPendingAccounts() {
  const { data, error } = await supabase.rpc('admin_pending_accounts')
  if (error) throw new Error(error.message)
  return data || []
}
export const adminLinkUser = ({ email, fullName, role = 'supplier', supplierId = null, position = 'ผู้ติดต่อ' }) =>
  rpc('admin_link_user', { p_email: email, p_full_name: fullName, p_role: role,
                           p_supplier_id: supplierId, p_position: position })
export const adminUnlinkUser = targetId => rpc('admin_unlink_user', { p_target: targetId })

export async function addSupplier({ code, name, taxId }) {
  const { data, error } = await supabase.from('suppliers')
    .insert({ code: code.trim(), name: name.trim(), tax_id: taxId?.trim() || null })
    .select('id, code, name').single()
  if (error) throw new Error(/duplicate|unique/i.test(error.message)
    ? `รหัสผู้ขาย ${code} มีอยู่แล้ว ใช้รหัสอื่น` : error.message)
  return data
}

// ============================ realtime ============================
export function subscribeTender(id, onChange) {
  const ch = supabase.channel(`tender:${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `tender_id=eq.${id}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tender_events', filter: `tender_id=eq.${id}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

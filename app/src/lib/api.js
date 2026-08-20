import { supabase, verifyClient } from './supabase'

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

// ยืนยันรหัสเดิมก่อนเปลี่ยน (กันคนที่แอบใช้เครื่องที่เปิดค้างไว้)
export async function changePassword(email, currentPassword, newPassword) {
  if (newPassword.length < 8) throw new Error('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร')
  if (newPassword === currentPassword) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม')

  // ขั้น 1 ตรวจรหัสเดิมด้วย client แยก — ไม่แตะ session หลัก ไม่แย่ง lock จึงไม่ค้าง
  console.info('[รหัสผ่าน] ขั้น 1/3 ตรวจรหัสเดิม')
  const { error: reauth } = await withTimeout(
    verifyClient().auth.signInWithPassword({ email, password: currentPassword }),
    12000, 'ขั้นตรวจรหัสเดิม')
  if (reauth) {
    console.warn('[รหัสผ่าน] ตรวจรหัสเดิมไม่ผ่าน:', reauth.message)
    throw new Error('รหัสผ่านเดิมไม่ถูกต้อง')
  }

  // ขั้น 2 เปลี่ยนรหัสจริงบน session ที่ล็อกอินอยู่
  console.info('[รหัสผ่าน] ขั้น 2/3 บันทึกรหัสใหม่')
  const { error } = await withTimeout(
    supabase.auth.updateUser({ password: newPassword }), 12000, 'ขั้นบันทึกรหัสใหม่')
  if (error) {
    if (/reauthentic/i.test(error.message))
      throw new Error('Supabase เปิดโหมด Secure password change อยู่ ให้ปิดที่ Authentication > Providers > Email หรือใช้ปุ่ม “ลืมรหัสผ่าน” แทน')
    throw new Error('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + error.message)
  }
  console.info('[รหัสผ่าน] ขั้น 3/3 บันทึกสถานะ')

  // รหัสผ่านเปลี่ยนสำเร็จแล้วตรงนี้ ที่เหลือคือลบธง must_change_password
  // ถ้าขั้นนี้พลาด ห้าม throw ทิ้ง เพราะผู้ใช้จะติดหน้าเดิมด้วยรหัสใหม่ที่ยังไม่รู้ตัว
  try {
    const { error: rpcErr } = await withTimeout(
      supabase.rpc('mark_password_changed'), 15000, 'การบันทึกสถานะ')
    if (rpcErr) throw rpcErr
  } catch (e) {
    return { warning: 'รหัสผ่านใหม่ใช้ได้แล้ว แต่ระบบยังบันทึกสถานะไม่สำเร็จ (' + (e.message || e) +
      ') ถ้ายังเจอหน้าให้เปลี่ยนรหัสอีก แจ้งฝ่ายจัดซื้อให้ล้างสถานะให้' }
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
    .eq('id', user.id).single()
  if (error) throw error
  return { ...data, email: user.email, org: data.suppliers?.name || 'ฝ่ายจัดซื้อกลาง' }
}

// ============================ tenders ============================
const TENDER_COLS = `
  id, code, title, description, type, budget, currency,
  opens_at, closes_at, unsealed_at, awarded_bid_id, awarded_at, created_at,
  tender_items(id, name, spec, qty, unit, sort),
  tender_invites(supplier_id, declined_at)`

export async function listTenders(supplierId) {
  const { data, error } = await supabase.from('tenders')
    .select(`${TENDER_COLS}, tender_events(id, kind, message, created_at)`)
    .order('closes_at', { ascending: false })
  if (error) throw error
  const rows = data || []

  const [counts, hammers, myBids] = await Promise.all([
    Promise.all(rows.map(t => supabase.rpc('tender_bid_count', { p_tender: t.id }))),
    Promise.all(rows.map(t => supabase.rpc('hammer_holder', { p_tender: t.id }))),
    supplierId
      ? supabase.from('bids').select('id, tender_id, total').eq('supplier_id', supplierId)
      : Promise.resolve({ data: [] }),
  ])
  const mine = Object.fromEntries((myBids.data || []).map(b => [b.tender_id, b]))

  return rows.map((t, i) => ({
    ...t,
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
    supabase.from('tenders').select(`${TENDER_COLS},
        tender_required_docs(id, label, sort),
        tender_files(id, file_name, file_path, size_bytes)`).eq('id', id).single(),
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
    supabase.from('tender_internal').select('target_price').eq('tender_id', id).maybeSingle(),
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
    target_price: internal.data?.target_price ?? null,   // null สำหรับผู้ขาย (RLS)
  }
}

// ============================ ไฟล์แนบ ============================
const safe = name => name.replace(/[^\w.\-ก-๙ ]+/g, '_').slice(-80)

export async function uploadBidFiles(tenderId, supplierId, files) {
  const out = []
  for (const f of files) {
    const path = `${tenderId}/${supplierId}/${Date.now()}-${safe(f.name)}`
    const { error } = await supabase.storage.from('bid-files').upload(path, f, { upsert: false })
    if (error) throw new Error(`อัปโหลด ${f.name} ไม่สำเร็จ: ${error.message}`)
    out.push({ file_name: f.name, file_path: path, size_bytes: f.size })
  }
  return out
}

export async function uploadTenderFiles(tenderId, files) {
  const rows = []
  for (const f of files) {
    const path = `${tenderId}/${Date.now()}-${safe(f.name)}`
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

export async function fileUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120)
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

// ============================ realtime ============================
export function subscribeTender(id, onChange) {
  const ch = supabase.channel(`tender:${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `tender_id=eq.${id}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tender_events', filter: `tender_id=eq.${id}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

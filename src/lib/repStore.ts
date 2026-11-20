import { supabase } from './supabaseClient'
import { splitMsg, classifyCode, type RepFile, type RepItem, type RepRejected } from './cignRep'

/** ตอนที่ในไฟล์ REP → ผู้จ่ายในระบบ (ตอนที่ 3 กสทช. / 4 กกต. / 5 เมืองพัทยา ยังไม่ทราบ payer_id — ต้องถามผู้ใช้ก่อนเพิ่ม) */
export const SECTION_PAYER: Record<number, string> = { 1: '50257' }

export type MatchStatus = 'matched' | 'no_admission' | 'payer_mismatch' | 'ambiguous' | 'unmapped_payer'

export const MATCH_LABEL: Record<MatchStatus, string> = {
  matched: 'พบเคส',
  no_admission: 'ไม่พบเคสในระบบ',
  payer_mismatch: 'พบเคส แต่ผู้จ่ายไม่ตรง',
  ambiguous: 'พบหลายแถว ระบุเคสไม่ได้',
  unmapped_payer: 'ไม่ทราบผู้จ่ายของตอนนี้',
}

export interface MatchResult {
  status: MatchStatus
  note: string
  admissionId: number | null
  payerId: string | null
  coverageCode: string | null
  claimNo: string | null
  hn: string | null
  dischargeDate: string | null
  /** ยอดที่เจนตั้งเบิก (ยอดส่งเบิก submission_amount) — ใช้เป็นยอดบรรทัด 11 ในไฟล์ SAP */
  claimAmount: number | null
}

const CHUNK = 200
const chunks = <T,>(a: T[], n = CHUNK): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

/** จับคู่ encounter_id (+ผู้จ่ายตามตอนที่ของ REP) กับ admissions และดึง claim_no / ยอดรับเอกสารจาก case_tracking_v */
export async function matchEncounters(inputs: { encounterId: number; section: number; allow?: { payer: string; coverage: string }[] }[]): Promise<Map<number, MatchResult>> {
  const ids = [...new Set(inputs.map((i) => i.encounterId))]
  type Adm = { admission_id: number; encounter_id: number; hn: string; discharge_date: string | null; payer_id: string; coverage_code: string }
  const adms: Adm[] = []
  for (const c of chunks(ids)) {
    const { data, error } = await supabase
      .from('admissions')
      .select('admission_id, encounter_id, hn, discharge_date, payer_id, coverage_code')
      .in('encounter_id', c)
    if (error) throw error
    adms.push(...((data ?? []) as Adm[]))
  }
  type Trk = { admission_id: number; claim_no: string | null; submission_amount: number | null }
  const trk = new Map<number, Trk>()
  for (const c of chunks(adms.map((a) => a.admission_id))) {
    const { data, error } = await supabase
      .from('case_tracking_v')
      .select('admission_id, claim_no, submission_amount')
      .in('admission_id', c)
    if (error) throw error
    for (const t of (data ?? []) as Trk[]) trk.set(Number(t.admission_id), t)
  }
  const byEnc = new Map<number, Adm[]>()
  for (const a of adms) byEnc.set(Number(a.encounter_id), [...(byEnc.get(Number(a.encounter_id)) ?? []), a])

  const empty = (status: MatchStatus, note: string): MatchResult => ({
    status, note, admissionId: null, payerId: null, coverageCode: null, claimNo: null, hn: null, dischargeDate: null, claimAmount: null,
  })
  const found = (a: Adm): MatchResult => {
    const t = trk.get(Number(a.admission_id))
    return {
      status: 'matched',
      note: '',
      admissionId: Number(a.admission_id),
      payerId: a.payer_id,
      coverageCode: a.coverage_code,
      claimNo: t?.claim_no ?? null,
      hn: a.hn,
      dischargeDate: a.discharge_date ? a.discharge_date.slice(0, 10) : null,
      claimAmount: t?.submission_amount == null ? null : Number(t.submission_amount),
    }
  }

  const out = new Map<number, MatchResult>()
  for (const { encounterId, section, allow } of inputs) {
    const list = byEnc.get(encounterId) ?? []
    if (list.length === 0) {
      out.set(encounterId, empty('no_admission', 'ไม่มี encounter_id นี้ในระบบ'))
      continue
    }
    // e-claim: จับคู่ตามชุด (ผู้จ่าย + สิทธิ) ที่ชนิดไฟล์กำหนด
    if (allow && allow.length > 0) {
      const label = allow.map((p) => `${p.coverage}/${p.payer}`).join(' หรือ ')
      const m = list.filter((a) => allow.some((p) => p.payer === a.payer_id && (a.coverage_code === p.coverage || a.coverage_code.startsWith(p.coverage + '_'))))
      if (m.length === 0) out.set(encounterId, empty('payer_mismatch', `ระบบมี ${list.map((a) => a.coverage_code + '/' + a.payer_id).join(', ')} แต่ไฟล์นี้คือ ${label}`))
      else if (m.length > 1) out.set(encounterId, empty('ambiguous', `มี ${m.length} แถวที่เป็น ${label}`))
      else out.set(encounterId, found(m[0]))
      continue
    }
    if (section > 0) {
      const expected = SECTION_PAYER[section]
      if (!expected) {
        out.set(encounterId, empty('unmapped_payer', `REP ตอนที่ ${section} ยังไม่ได้กำหนดผู้จ่าย (ระบบมี ${list.map((a) => a.payer_id).join(', ')})`))
        continue
      }
      const m = list.filter((a) => a.payer_id === expected)
      if (m.length === 0) out.set(encounterId, empty('payer_mismatch', `ระบบมีผู้จ่าย ${list.map((a) => a.payer_id).join(', ')} แต่ REP ตอนที่ ${section} คือ ${expected}`))
      else if (m.length > 1) out.set(encounterId, empty('ambiguous', `มี ${m.length} แถวที่ผู้จ่าย ${expected}`))
      else out.set(encounterId, found(m[0]))
      continue
    }
    // รายการไม่ผ่านไม่ระบุตอนที่ → ถ้ามีแถวเดียวถือว่าตรง ถ้ามีหลายแถว (แยกสิทธิ) ต้องระบุเอง
    if (list.length === 1) out.set(encounterId, found(list[0]))
    else out.set(encounterId, empty('ambiguous', `encounter นี้มี ${list.length} แถว (${list.map((a) => a.coverage_code + '/' + a.payer_id).join(', ')}) ระบุเองว่าแถวไหน`))
  }
  return out
}

/** คอลัมน์ของ rep_files ที่โหลดเป็นรายการ — ไม่รวม raw_text (ข้อความเต็มของไฟล์ โหลดเฉพาะตอนเปิดดู) */
const FILE_COLS = 'id, hosp_code, rep_no, issue_date, header_count, header_total, passed_count, not_passed_count, source_file_name, uploaded_at'

export interface SavedFile {
  id: number
  hosp_code: string
  rep_no: string
  issue_date: string
  header_count: number | null
  header_total: number | null
  passed_count: number
  not_passed_count: number
  source_file_name: string | null
  uploaded_at: string
}

export interface SavedItem {
  id: number
  rep_file_id: number
  encounter_id: number
  section: number | null
  patient_name: string | null
  tcode: string
  pcode: string | null
  drg_code: string | null
  rw: number | null
  adj_rw: number | null
  ccuf: number | null
  drg_amount: number | null
  out_drg_amount: number | null
  total_amount: number | null
  msg_raw: string | null
  match_status: MatchStatus
  match_note: string | null
  admission_id: number | null
  payer_id: string | null
  coverage_code: string | null
  claim_no: string | null
  sap_generated_at: string | null
  sap_file_name: string | null
  codes_more: number | null
  dup_flag: DupFlag | null
  dup_note: string | null
}

/* ───────────── เลขซ้ำ: REP = รายการที่เราส่งเบิกไปจริง จึงซ้ำได้เฉพาะ "ติด C แล้วแก้ส่งใหม่ด้วยเลขตั้งเบิกใหม่" ───────────── */

export type DupFlag = 'resubmitted_after_c' | 'duplicate_after_a' | 'same_claim_no'

export interface DupInfo {
  flag: DupFlag
  note: string
  /** true = ผิดปกติ ต้องให้ผู้ใช้เลือก ข้าม / บันทึกไว้ (ติดป้าย) · false = ส่งใหม่หลังติด C ตามปกติ */
  needsDecision: boolean
  prevRepNo: string
  prevTcode: string
}

export const DUP_LABEL: Record<DupFlag, string> = {
  resubmitted_after_c: 'ส่งใหม่หลังติด C',
  duplicate_after_a: 'ซ้ำ: เคยผ่านแล้ว',
  same_claim_no: 'ซ้ำ: เลขตั้งเบิกเดิม',
}

/**
 * ตรวจแต่ละเคสของไฟล์ที่กำลังจะบันทึกกับ REP ก่อนหน้าของเคสเดียวกัน (admission_id เดียวกัน, ไม่นับไฟล์เดียวกัน)
 *  - ก่อนหน้า = C/T และเลขตั้งเบิกใหม่ต่างจากเดิม → ปกติ (ส่งใหม่หลังแก้ C ผ่านหรือไม่ผ่านก็ได้)
 *  - ก่อนหน้า = C/T แต่เลขตั้งเบิกเดิม/ไม่มี → ผิดปกติ (ยังไม่มีเลขตั้งเบิกใหม่)
 *  - ก่อนหน้า = A (ผ่านแล้ว) → ผิดปกติ ไม่ควรมีซ้ำ
 */
export async function checkDuplicates(rep: RepFile, matches: Map<number, MatchResult>): Promise<Map<number, DupInfo>> {
  const encs = [...rep.items.map((i) => i.encounterId), ...rep.notPassed.map((n) => n.encounterId)]
  const byAdm = new Map<number, number>() // admission_id → encounter_id
  for (const e of encs) {
    const m = matches.get(e)
    if (m?.status === 'matched' && m.admissionId != null) byAdm.set(m.admissionId, e)
  }
  type Prev = { admission_id: number; tcode: string; claim_no: string | null; id: number; rep_files: { rep_no: string; hosp_code: string; issue_date: string } | { rep_no: string; hosp_code: string; issue_date: string }[] | null }
  const prevs: Prev[] = []
  for (const c of chunks([...byAdm.keys()])) {
    const { data, error } = await supabase
      .from('rep_items')
      .select('admission_id, tcode, claim_no, id, rep_files(rep_no, hosp_code, issue_date)')
      .in('admission_id', c)
    if (error) throw error
    prevs.push(...((data ?? []) as unknown as Prev[]))
  }
  const fileOf = (p: Prev) => (Array.isArray(p.rep_files) ? p.rep_files[0] : p.rep_files)
  const out = new Map<number, DupInfo>()
  for (const [adm, enc] of byAdm) {
    const older = prevs
      .filter((p) => p.admission_id === adm)
      .filter((p) => {
        const f = fileOf(p)
        return f && !(f.hosp_code === rep.hospCode && f.rep_no === rep.repNo) && f.issue_date <= rep.issueDate
      })
      .sort((a, b) => (fileOf(a)!.issue_date === fileOf(b)!.issue_date ? a.id - b.id : fileOf(a)!.issue_date < fileOf(b)!.issue_date ? -1 : 1))
    const prev = older[older.length - 1]
    if (!prev) continue
    const pf = fileOf(prev)!
    const cur = matches.get(enc)?.claimNo ?? null
    if (prev.tcode === 'A') {
      out.set(enc, { flag: 'duplicate_after_a', needsDecision: true, prevRepNo: pf.rep_no, prevTcode: 'A', note: `เคสนี้ผ่าน (A) แล้วใน REP ${pf.rep_no} ปกติไม่ควรมีซ้ำ` })
    } else if (cur && prev.claim_no && cur !== prev.claim_no) {
      out.set(enc, { flag: 'resubmitted_after_c', needsDecision: false, prevRepNo: pf.rep_no, prevTcode: prev.tcode, note: `ติด ${prev.tcode} ใน REP ${pf.rep_no} (เลขตั้งเบิก ${prev.claim_no}) ส่งใหม่ด้วยเลขตั้งเบิก ${cur}` })
    } else {
      out.set(enc, {
        flag: 'same_claim_no',
        needsDecision: true,
        prevRepNo: pf.rep_no,
        prevTcode: prev.tcode,
        note: `ติด ${prev.tcode} ใน REP ${pf.rep_no} แต่เลขตั้งเบิกยังเป็น ${cur ?? '(ไม่มี)'} ไม่ใช่เลขใหม่ — ส่งใหม่ต้องมีเลขตั้งเบิกใหม่ (ตรวจว่าอัปไฟล์ GGO รอบใหม่แล้วหรือยัง)`,
      })
    }
  }
  return out
}

export type ParsedRow =
  | { kind: 'A'; item: RepItem }
  | { kind: 'N'; item: RepRejected }

const numOrNull = (v: unknown) => (v == null ? null : Number(v))

export interface SaveOptions {
  /** encounter_id ที่ผู้ใช้เลือกข้าม (ไม่บันทึก) */
  skip?: Set<number>
  dups?: Map<number, DupInfo>
}

export interface SaveResult {
  saved: number
  skipped: number
  codes: number
  newMasterCodes: number
}

/**
 * บันทึก REP ทั้งไฟล์ (ทั้งรายการผ่านและไม่ผ่าน) พร้อมผลจับคู่ — บันทึกซ้ำเลขเดิมจะอัปเดตข้อมูล ไม่แตะสถานะสร้างไฟล์ SAP
 * นอกจากนี้: เก็บข้อความเต็มของไฟล์, แตกรหัส error (ก่อน 837) ของแต่ละเคสลง rep_item_codes,
 * ติดป้ายเลขซ้ำ (dup_flag) และเติมรหัสใหม่ที่ยังไม่มีใน master C จากตารางรหัสท้ายไฟล์
 */
export async function saveRep(rep: RepFile, fileName: string, matches: Map<number, MatchResult>, opts: SaveOptions = {}): Promise<SaveResult> {
  const skip = opts.skip ?? new Set<number>()
  const { data: f, error: fe } = await supabase
    .from('rep_files')
    .upsert(
      {
        hosp_code: rep.hospCode,
        rep_no: rep.repNo,
        issue_date: rep.issueDate,
        header_count: rep.headerCount,
        header_total: rep.headerTotal,
        passed_count: rep.items.length,
        not_passed_count: rep.notPassed.length,
        source_file_name: fileName,
        raw_text: rep.rawText,
      },
      { onConflict: 'hosp_code,rep_no' },
    )
    .select('id')
    .single()
  if (fe) throw fe
  const fileId = Number((f as { id: number }).id)

  const m = (enc: number) => matches.get(enc)
  const common = (enc: number, msgRaw: string) => {
    const r = m(enc)
    const d = opts.dups?.get(enc)
    return {
      rep_file_id: fileId,
      encounter_id: enc,
      match_status: r?.status ?? 'no_admission',
      match_note: r?.note || null,
      admission_id: r?.admissionId ?? null,
      payer_id: r?.payerId ?? null,
      coverage_code: r?.coverageCode ?? null,
      claim_no: r?.claimNo ?? null,
      codes_more: splitMsg(msgRaw).more,
      dup_flag: d?.flag ?? null,
      dup_note: d?.note ?? null,
    }
  }
  const all = [
    ...rep.items.map((i) => ({
      ...common(i.encounterId, i.msgRaw),
      section: i.section,
      patient_name: i.name,
      tcode: 'A',
      pcode: i.pcode,
      drg_code: i.drgCode,
      rw: i.rw,
      adj_rw: i.adjRw,
      ccuf: i.ccuf,
      drg_amount: i.drgAmount,
      out_drg_amount: i.outDrgAmount,
      total_amount: i.paid,
      msg_raw: i.msgRaw || null,
    })),
    ...rep.notPassed.map((n) => ({
      ...common(n.encounterId, n.msgRaw),
      section: null,
      patient_name: n.name,
      tcode: n.tcode,
      pcode: null,
      drg_code: null,
      rw: null,
      adj_rw: null,
      ccuf: null,
      drg_amount: null,
      out_drg_amount: null,
      total_amount: null,
      msg_raw: n.msgRaw || null,
    })),
  ]
  const payload = all.filter((p) => !skip.has(p.encounter_id))

  // 1) บันทึกรายการ แล้วรับ id กลับมาเพื่อผูกรหัส error รายเคส
  const idByEnc = new Map<number, number>()
  for (const c of chunks(payload)) {
    const { data, error } = await supabase.from('rep_items').upsert(c, { onConflict: 'rep_file_id,encounter_id' }).select('id, encounter_id')
    if (error) throw error
    for (const r of (data ?? []) as { id: number; encounter_id: number }[]) idByEnc.set(Number(r.encounter_id), Number(r.id))
  }

  // 2) แตกรหัส error (ก่อน 837) รายเคส — ลบของเดิมของรายการเหล่านี้ก่อนเพื่อไม่ให้ซ้ำเมื่อบันทึกไฟล์เดิมอีกครั้ง
  const codeRows: { rep_item_id: number; seq: number; code: string; detail: string | null; kind: string }[] = []
  for (const p of payload) {
    const itemId = idByEnc.get(p.encounter_id)
    if (itemId == null) continue
    let seq = 0
    for (const c of splitMsg(p.msg_raw).codes) {
      if (c.kind !== 'error') continue
      seq += 1
      codeRows.push({ rep_item_id: itemId, seq, code: c.code, detail: c.detail, kind: 'error' })
    }
  }
  for (const c of chunks([...idByEnc.values()])) {
    const { error } = await supabase.from('rep_item_codes').delete().in('rep_item_id', c)
    if (error) throw error
  }
  for (const c of chunks(codeRows)) {
    const { error } = await supabase.from('rep_item_codes').insert(c)
    if (error) throw error
  }

  // 3) เติม master C: รหัสที่พบในไฟล์นี้แต่ยังไม่มี (ใช้ตารางรหัสท้ายไฟล์) — ไม่แตะรหัสที่มีอยู่แล้ว
  let newMaster = 0
  const payer = payload.map((p) => p.payer_id).find((x): x is string => !!x)
  if (payer && rep.legend.length > 0) {
    const { data: have, error: he } = await supabase.from('rep_code_master').select('code').eq('payer_id', payer)
    if (he) throw he
    const known = new Set(((have ?? []) as { code: string }[]).map((r) => r.code))
    const add = rep.legend
      .filter((l) => !known.has(l.code))
      .map((l) => ({ payer_id: payer, code: l.code, kind: classifyCode(l.code), description: l.description, rep_advice: l.advice, source: 'rep_legend' }))
    if (add.length > 0) {
      const { error } = await supabase.from('rep_code_master').upsert(add, { onConflict: 'payer_id,code', ignoreDuplicates: true })
      if (error) throw error
      newMaster = add.length
    }
  }
  return { saved: payload.length, skipped: all.length - payload.length, codes: codeRows.length, newMasterCodes: newMaster }
}

/** ข้อความเต็มของไฟล์ REP ที่บันทึกไว้ (ไฟล์ที่บันทึกก่อนมีฟีเจอร์นี้จะเป็น null — อัปโหลดใหม่เพื่อเก็บ) */
export async function loadRawText(fileId: number): Promise<string | null> {
  const { data, error } = await supabase.from('rep_files').select('raw_text').eq('id', fileId).maybeSingle()
  if (error) throw error
  return (data as { raw_text: string | null } | null)?.raw_text ?? null
}

export async function findSavedFile(hosp: string, repNo: string): Promise<{ file: SavedFile; generated: number } | null> {
  const { data, error } = await supabase.from('rep_files').select(FILE_COLS).eq('hosp_code', hosp).eq('rep_no', repNo).maybeSingle()
  if (error) throw error
  if (!data) return null
  const f = data as SavedFile
  const { count, error: e2 } = await supabase
    .from('rep_items')
    .select('id', { count: 'exact', head: true })
    .eq('rep_file_id', f.id)
    .not('sap_generated_at', 'is', null)
  if (e2) throw e2
  return { file: f, generated: count ?? 0 }
}

export async function listSavedFiles(): Promise<SavedFile[]> {
  const { data, error } = await supabase.from('rep_files').select(FILE_COLS).order('issue_date', { ascending: false }).order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as SavedFile[]
}

export async function loadSavedItems(fileId: number): Promise<SavedItem[]> {
  const out: SavedItem[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('rep_items')
      .select('*')
      .eq('rep_file_id', fileId)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    const rows = (data ?? []) as SavedItem[]
    out.push(...rows.map((r) => ({ ...r, rw: numOrNull(r.rw), adj_rw: numOrNull(r.adj_rw), ccuf: numOrNull(r.ccuf), drg_amount: numOrNull(r.drg_amount), out_drg_amount: numOrNull(r.out_drg_amount), total_amount: numOrNull(r.total_amount) })))
    if (rows.length < 1000) break
  }
  return out
}

/** อัปเดตผลจับคู่ที่บันทึกไว้ให้ตรงกับข้อมูลล่าสุด */
export async function updateMatches(items: { id: number; match: MatchResult }[]): Promise<void> {
  for (const it of items) {
    const { error } = await supabase
      .from('rep_items')
      .update({
        match_status: it.match.status,
        match_note: it.match.note || null,
        admission_id: it.match.admissionId,
        payer_id: it.match.payerId,
        coverage_code: it.match.coverageCode,
        claim_no: it.match.claimNo,
      })
      .eq('id', it.id)
    if (error) throw error
  }
}

/** บันทึกว่าสร้างไฟล์ SAP ของรายการเหล่านี้แล้ว */
export async function markSapGenerated(itemIds: number[], fileName: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser()
  const by = u.user?.id ?? null
  for (const c of chunks(itemIds)) {
    const { error } = await supabase
      .from('rep_items')
      .update({ sap_generated_at: new Date().toISOString(), sap_generated_by: by, sap_file_name: fileName })
      .in('id', c)
    if (error) throw error
  }
}

/* ───────────── Master C (รหัสผลตรวจรับ + วิธีแก้ของเรา) ───────────── */

export interface MasterCode {
  payer_id: string
  code: string
  kind: 'error' | 'warning' | 'info'
  description: string | null
  rep_advice: string | null
  our_fix: string | null
}

export async function loadMaster(): Promise<MasterCode[]> {
  const { data, error } = await supabase
    .from('rep_code_master')
    .select('payer_id, code, kind, description, rep_advice, our_fix')
    .order('payer_id')
    .order('code')
  if (error) throw error
  return (data ?? []) as MasterCode[]
}

/** บันทึก "วิธีแก้ของเรา" ของรหัส (ผ่าน RPC — role user แก้ได้เฉพาะช่องนี้) */
export async function saveFix(payerId: string, code: string, fix: string): Promise<void> {
  const { error } = await supabase.rpc('set_rep_code_fix', { p_payer: payerId, p_code: code, p_fix: fix })
  if (error) throw error
}

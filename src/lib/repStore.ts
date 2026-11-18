import { supabase } from './supabaseClient'
import type { RepFile, RepItem, RepRejected } from './cignRep'

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
  /** ยอดรับเอกสาร (HIS) */
  his: number | null
}

const CHUNK = 200
const chunks = <T,>(a: T[], n = CHUNK): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

/** จับคู่ encounter_id (+ผู้จ่ายตามตอนที่ของ REP) กับ admissions และดึง claim_no / ยอดรับเอกสารจาก case_tracking_v */
export async function matchEncounters(inputs: { encounterId: number; section: number }[]): Promise<Map<number, MatchResult>> {
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
  type Trk = { admission_id: number; claim_no: string | null; document_received_amount: number | null }
  const trk = new Map<number, Trk>()
  for (const c of chunks(adms.map((a) => a.admission_id))) {
    const { data, error } = await supabase
      .from('case_tracking_v')
      .select('admission_id, claim_no, document_received_amount')
      .in('admission_id', c)
    if (error) throw error
    for (const t of (data ?? []) as Trk[]) trk.set(Number(t.admission_id), t)
  }
  const byEnc = new Map<number, Adm[]>()
  for (const a of adms) byEnc.set(Number(a.encounter_id), [...(byEnc.get(Number(a.encounter_id)) ?? []), a])

  const empty = (status: MatchStatus, note: string): MatchResult => ({
    status, note, admissionId: null, payerId: null, coverageCode: null, claimNo: null, hn: null, dischargeDate: null, his: null,
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
      his: t?.document_received_amount == null ? null : Number(t.document_received_amount),
    }
  }

  const out = new Map<number, MatchResult>()
  for (const { encounterId, section } of inputs) {
    const list = byEnc.get(encounterId) ?? []
    if (list.length === 0) {
      out.set(encounterId, empty('no_admission', 'ไม่มี encounter_id นี้ในระบบ'))
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
}

export type ParsedRow =
  | { kind: 'A'; item: RepItem }
  | { kind: 'N'; item: RepRejected }

const numOrNull = (v: unknown) => (v == null ? null : Number(v))

/** บันทึก REP ทั้งไฟล์ (ทั้งรายการผ่านและไม่ผ่าน) พร้อมผลจับคู่ — บันทึกซ้ำเลขเดิมจะอัปเดตข้อมูล ไม่แตะสถานะสร้างไฟล์ SAP */
export async function saveRep(rep: RepFile, fileName: string, matches: Map<number, MatchResult>): Promise<number> {
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
      },
      { onConflict: 'hosp_code,rep_no' },
    )
    .select('id')
    .single()
  if (fe) throw fe
  const fileId = Number((f as { id: number }).id)

  const m = (enc: number) => matches.get(enc)
  const common = (enc: number) => {
    const r = m(enc)
    return {
      rep_file_id: fileId,
      encounter_id: enc,
      match_status: r?.status ?? 'no_admission',
      match_note: r?.note || null,
      admission_id: r?.admissionId ?? null,
      payer_id: r?.payerId ?? null,
      coverage_code: r?.coverageCode ?? null,
      claim_no: r?.claimNo ?? null,
    }
  }
  const payload = [
    ...rep.items.map((i) => ({
      ...common(i.encounterId),
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
      ...common(n.encounterId),
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
  for (const c of chunks(payload)) {
    const { error } = await supabase.from('rep_items').upsert(c, { onConflict: 'rep_file_id,encounter_id' })
    if (error) throw error
  }
  return payload.length
}

export async function findSavedFile(hosp: string, repNo: string): Promise<{ file: SavedFile; generated: number } | null> {
  const { data, error } = await supabase.from('rep_files').select('*').eq('hosp_code', hosp).eq('rep_no', repNo).maybeSingle()
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
  const { data, error } = await supabase.from('rep_files').select('*').order('issue_date', { ascending: false }).order('id', { ascending: false })
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

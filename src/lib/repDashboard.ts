import { supabase } from './supabaseClient'

/**
 * Dashboard ผลตอบกลับ REP — 1 แถว = 1 เคส (admission) แสดง REP ล่าสุดของเคสนั้น
 *  - ผ่าน  = REP ล่าสุดเป็น A
 *  - ติด C = REP ล่าสุดเป็น C (resent = ส่งแก้ด้วยเลขเดิมแล้ว วันที่ส่งเบิกใหม่กว่าวันที่ REP ตอบ C)
 *  - other = สถานะอื่น (เช่น T)
 * REP ที่ยังจับคู่เคสไม่ได้ (admission_id ว่าง) จะแสดงด้วย (unmatched) ไม่ข้ามเงียบ ๆ
 */
export type RepResult = 'passed' | 'c' | 'other'

export interface RepRow {
  key: string
  admissionId: number | null
  encounterId: number
  hn: string | null
  name: string | null
  dischargeDate: string | null
  coverageCode: string | null
  payerId: string | null
  /** เลขตั้งเบิกปัจจุบันของเคส (จากหน้าหลัก) */
  currentClaimNo: string | null
  submissionDate: string | null
  /** ยอดที่ตั้งเบิก (submission_amount จากหน้าหลัก) */
  claimedAmount: number | null
  /** ยอดที่จ่าย จาก REP ล่าสุดของเคส (total_amount) */
  paidAmount: number | null
  /** ส่วนต่าง = ยอดที่จ่าย (REP) − ยอดที่ตั้งเบิก · null ถ้าขาดฝั่งใดฝั่งหนึ่ง */
  diffAmount: number | null
  repNo: string
  /** วันที่กองทุนตอบกลับ (วันที่ออกรายงาน REP ล่าสุด) */
  replyDate: string
  tcode: string
  result: RepResult
  /** ติด C แต่ส่งแก้แล้ว รอ REP รอบใหม่ */
  resent: boolean
  /** จำนวนรอบที่เคยติด C */
  cRounds: number
  unmatched: boolean
}

type FileRef = { rep_no: string; issue_date: string }
type Item = {
  id: number
  encounter_id: number
  admission_id: number | null
  patient_name: string | null
  tcode: string
  claim_no: string | null
  payer_id: string | null
  coverage_code: string | null
  total_amount: number | string | null
  rep_files: FileRef | FileRef[] | null
}

const SEL = 'id, encounter_id, admission_id, patient_name, tcode, claim_no, payer_id, coverage_code, total_amount, rep_files(rep_no, issue_date)'
const numOrNull = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const round2 = (n: number) => Math.round(n * 100) / 100
const fileOf = (r: Item): FileRef => (Array.isArray(r.rep_files) ? r.rep_files[0] : r.rep_files) ?? { rep_no: '?', issue_date: '1970-01-01' }

const chunks = <T,>(a: T[], n = 200): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  return out
}

export async function loadRepRows(): Promise<RepRow[]> {
  const items = await pageAll<Item>((a, b) =>
    supabase.from('rep_items').select(SEL).order('id', { ascending: true }).range(a, b) as unknown as PromiseLike<{ data: Item[] | null; error: { message: string } | null }>,
  )

  const groups = new Map<string, Item[]>()
  for (const it of items) {
    const k = it.admission_id != null ? `a${it.admission_id}` : `e${it.encounter_id}`
    groups.set(k, [...(groups.get(k) ?? []), it])
  }

  const admIds = [...new Set(items.map((i) => i.admission_id).filter((x): x is number => x != null))]
  const adm = new Map<number, { hn: string; discharge_date: string | null; coverage_code: string; payer_id: string }>()
  const trk = new Map<number, { claim_no: string | null; submission_date: string | null; submission_amount: number | string | null }>()
  for (const c of chunks(admIds)) {
    const [a, t] = await Promise.all([
      supabase.from('admissions').select('admission_id, hn, discharge_date, coverage_code, payer_id').in('admission_id', c),
      supabase.from('case_tracking_v').select('admission_id, claim_no, submission_date, submission_amount').in('admission_id', c),
    ])
    if (a.error) throw new Error(a.error.message)
    if (t.error) throw new Error(t.error.message)
    for (const r of (a.data ?? []) as { admission_id: number; hn: string; discharge_date: string | null; coverage_code: string; payer_id: string }[]) adm.set(Number(r.admission_id), r)
    for (const r of (t.data ?? []) as { admission_id: number; claim_no: string | null; submission_date: string | null; submission_amount: number | string | null }[]) trk.set(Number(r.admission_id), r)
  }

  const out: RepRow[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort((x, y) => {
      const fx = fileOf(x).issue_date
      const fy = fileOf(y).issue_date
      return fx === fy ? Number(x.id) - Number(y.id) : fx < fy ? -1 : 1
    })
    const last = sorted[sorted.length - 1]
    const f = fileOf(last)
    const admissionId = last.admission_id == null ? null : Number(last.admission_id)
    const a = admissionId != null ? adm.get(admissionId) : undefined
    const t = admissionId != null ? trk.get(admissionId) : undefined
    const submissionDate = t?.submission_date ? t.submission_date.slice(0, 10) : null
    const result: RepResult = last.tcode === 'A' ? 'passed' : last.tcode === 'C' ? 'c' : 'other'
    const claimedAmount = numOrNull(t?.submission_amount)
    const paidAmount = numOrNull(last.total_amount)
    out.push({
      key,
      admissionId,
      encounterId: Number(last.encounter_id),
      hn: a?.hn ?? null,
      name: [...sorted].reverse().find((r) => r.patient_name)?.patient_name ?? null,
      dischargeDate: a?.discharge_date ? a.discharge_date.slice(0, 10) : null,
      coverageCode: a?.coverage_code ?? last.coverage_code,
      payerId: a?.payer_id ?? last.payer_id,
      currentClaimNo: t?.claim_no ?? null,
      submissionDate,
      claimedAmount,
      paidAmount,
      diffAmount: claimedAmount != null && paidAmount != null ? round2(paidAmount - claimedAmount) : null,
      repNo: f.rep_no,
      replyDate: f.issue_date.slice(0, 10),
      tcode: last.tcode,
      result,
      resent: result === 'c' && !!submissionDate && submissionDate > f.issue_date.slice(0, 10),
      cRounds: sorted.filter((r) => r.tcode === 'C').length,
      unmatched: admissionId == null,
    })
  }
  return out.sort((x, y) => y.replyDate.localeCompare(x.replyDate) || x.encounterId - y.encounterId)
}

/** ชื่อสิทธิ / ผู้จ่าย ไว้แสดงในตัวกรองและตาราง */
export async function loadNames(): Promise<{ coverage: Map<string, string>; payer: Map<string, string> }> {
  const [c, p] = await Promise.all([
    supabase.from('coverage_master').select('coverage_code, coverage_name'),
    supabase.from('payer_master').select('payer_id, payer_name'),
  ])
  if (c.error) throw new Error(c.error.message)
  if (p.error) throw new Error(p.error.message)
  return {
    coverage: new Map(((c.data ?? []) as { coverage_code: string; coverage_name: string }[]).map((r) => [r.coverage_code, r.coverage_name])),
    payer: new Map(((p.data ?? []) as { payer_id: string; payer_name: string }[]).map((r) => [r.payer_id, r.payer_name])),
  }
}

/* ───────────── ตารางรวมผลตอบกลับ: สิทธิ × ผู้จ่าย → เลข REP ───────────── */

export interface RepSummaryLine {
  coverageCode: string
  payerId: string
  repNo: string
  replyDate: string
  total: number
  passed: number
  c: number
  other: number
}

/** นับจาก "REP ล่าสุดของแต่ละเคส" — เคสที่ผ่านใน REP รอบหลังจะไปนับอยู่ในเลข REP รอบหลัง */
export function buildSummary(rows: RepRow[]): RepSummaryLine[] {
  const m = new Map<string, RepSummaryLine>()
  for (const r of rows) {
    const k = `${r.coverageCode ?? '–'}|${r.payerId ?? '–'}|${r.repNo}`
    const line = m.get(k) ?? { coverageCode: r.coverageCode ?? '–', payerId: r.payerId ?? '–', repNo: r.repNo, replyDate: r.replyDate, total: 0, passed: 0, c: 0, other: 0 }
    line.total++
    if (r.result === 'passed') line.passed++
    else if (r.result === 'c') line.c++
    else line.other++
    m.set(k, line)
  }
  return [...m.values()].sort((a, b) => a.coverageCode.localeCompare(b.coverageCode) || a.payerId.localeCompare(b.payerId) || b.replyDate.localeCompare(a.replyDate) || b.repNo.localeCompare(a.repNo))
}

export const RESULT_LABEL = (r: RepRow): string => (r.result === 'passed' ? 'ผ่าน' : r.result === 'c' ? 'ติด C' : `อื่น ๆ (${r.tcode})`)

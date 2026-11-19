import { supabase } from './supabaseClient'
import { splitMsg } from './cignRep'

/**
 * Code C แบบใหม่: คำนวณสดจากผลตอบกลับ REP ที่บันทึกไว้ (rep_items / rep_item_codes) + เลขตั้งเบิกปัจจุบันของเคส
 *  - open   = REP ล่าสุดของเคสเป็น C และยังไม่มีเลขตั้งเบิกใหม่ → ค้างแก้
 *  - resent = REP ล่าสุดเป็น C แต่เคสมีเลขตั้งเบิกใหม่แล้ว → ส่งใหม่แล้ว รอผลตอบกลับรอบใหม่
 *  - passed = REP ล่าสุดของเคสเป็น A → ผ่านแล้ว (เคยติด C มาก่อน)
 *  - other  = REP ล่าสุดเป็นสถานะอื่น (เช่น T รอใบรับรองสิทธิ)
 */
export type CStatus = 'open' | 'resent' | 'passed' | 'other'

export const STATUS_LABEL: Record<CStatus, string> = {
  open: 'ค้างแก้',
  resent: 'ส่งใหม่แล้ว รอผล',
  passed: 'ผ่านแล้ว',
  other: 'อื่น ๆ',
}

export interface CCode {
  code: string
  detail: string | null
}

export interface CRound {
  itemId: number
  tcode: string
  repNo: string
  issueDate: string
  claimNo: string | null
  /** รหัส error ที่ต้องแก้ (ก่อน 837) */
  errors: CCode[]
  /** จำนวนรหัสเตือน/แจ้งทราบ (837, 83A, 926 และที่ไฟล์ตัดไม่แสดง) — ไม่ต้องแก้ */
  warnCount: number
  msgRaw: string | null
}

export interface CCase {
  key: string
  admissionId: number | null
  encounterId: number
  name: string | null
  hn: string | null
  dischargeDate: string | null
  coverageCode: string | null
  payerId: string | null
  currentClaimNo: string | null
  submissionDate: string | null
  rounds: CRound[]
  /** รอบล่าสุดที่เป็น C (รหัสที่ต้องไปแก้อยู่ที่รอบนี้) */
  lastC: CRound
  latest: CRound
  cRounds: number
  status: CStatus
  /** วันนับจากวันที่ REP ตอบ C ล่าสุด (เฉพาะค้างแก้) */
  daysOpen: number | null
}

const CHUNK = 200
const chunks = <T,>(a: T[], n = CHUNK): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

type FileRef = { rep_no: string; issue_date: string }
type RawItem = {
  id: number
  encounter_id: number
  admission_id: number | null
  patient_name: string | null
  tcode: string
  claim_no: string | null
  msg_raw: string | null
  codes_more: number | null
  payer_id: string | null
  coverage_code: string | null
  rep_files: FileRef | FileRef[] | null
  rep_item_codes: { seq: number; code: string; detail: string | null; kind: string }[] | null
}
const SEL =
  'id, encounter_id, admission_id, patient_name, tcode, claim_no, msg_raw, codes_more, payer_id, coverage_code, rep_files(rep_no, issue_date), rep_item_codes(seq, code, detail, kind)'

const fileOf = (r: RawItem): FileRef => {
  const f = Array.isArray(r.rep_files) ? r.rep_files[0] : r.rep_files
  return f ?? { rep_no: '?', issue_date: '1970-01-01' }
}

function toRound(r: RawItem): CRound {
  const f = fileOf(r)
  const saved = (r.rep_item_codes ?? []).filter((c) => c.kind === 'error').sort((a, b) => a.seq - b.seq)
  const parsed = splitMsg(r.msg_raw)
  const errors: CCode[] = saved.length > 0 ? saved.map((c) => ({ code: c.code, detail: c.detail })) : parsed.codes.filter((c) => c.kind === 'error').map((c) => ({ code: c.code, detail: c.detail }))
  const warnCount = parsed.codes.filter((c) => c.kind !== 'error').length + (r.codes_more ?? parsed.more)
  return { itemId: Number(r.id), tcode: r.tcode, repNo: f.rep_no, issueDate: f.issue_date, claimNo: r.claim_no, errors, warnCount, msgRaw: r.msg_raw }
}

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const dayDiff = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)

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

/** โหลดเคสที่เคยติด C ทั้งหมดพร้อมประวัติแต่ละรอบ และสถานะปัจจุบัน */
export async function loadCCases(): Promise<CCase[]> {
  // 1) ทุกรายการที่เคยติด C
  const cItems = await pageAll<RawItem>((a, b) =>
    supabase.from('rep_items').select(SEL).eq('tcode', 'C').order('id', { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: RawItem[] | null; error: { message: string } | null }>,
  )
  const admIds = [...new Set(cItems.map((c) => c.admission_id).filter((x): x is number => x != null))]

  // 2) ประวัติทุกรอบ (A/C/T) ของเคสเหล่านั้น
  const hist: RawItem[] = []
  for (const c of chunks(admIds)) {
    const { data, error } = await supabase.from('rep_items').select(SEL).in('admission_id', c)
    if (error) throw new Error(error.message)
    hist.push(...((data ?? []) as unknown as RawItem[]))
  }

  // 3) เลขตั้งเบิกปัจจุบัน + ข้อมูลเคส
  const trk = new Map<number, { claim_no: string | null; submission_date: string | null }>()
  const adm = new Map<number, { hn: string; discharge_date: string | null; coverage_code: string; payer_id: string }>()
  for (const c of chunks(admIds)) {
    const [t, a] = await Promise.all([
      supabase.from('case_tracking_v').select('admission_id, claim_no, submission_date').in('admission_id', c),
      supabase.from('admissions').select('admission_id, hn, discharge_date, coverage_code, payer_id').in('admission_id', c),
    ])
    if (t.error) throw new Error(t.error.message)
    if (a.error) throw new Error(a.error.message)
    for (const r of (t.data ?? []) as { admission_id: number; claim_no: string | null; submission_date: string | null }[]) trk.set(Number(r.admission_id), r)
    for (const r of (a.data ?? []) as { admission_id: number; hn: string; discharge_date: string | null; coverage_code: string; payer_id: string }[]) adm.set(Number(r.admission_id), r)
  }

  const today = todayIso()
  const sortRounds = (rs: RawItem[]) =>
    [...rs].sort((x, y) => {
      const fx = fileOf(x).issue_date
      const fy = fileOf(y).issue_date
      return fx === fy ? Number(x.id) - Number(y.id) : fx < fy ? -1 : 1
    })

  const build = (key: string, items: RawItem[]): CCase => {
    const sorted = sortRounds(items)
    const rounds = sorted.map(toRound)
    const latest = rounds[rounds.length - 1]
    const lastC = [...rounds].reverse().find((r) => r.tcode === 'C') ?? latest
    const last = sorted[sorted.length - 1]
    const admissionId = last.admission_id == null ? null : Number(last.admission_id)
    const t = admissionId != null ? trk.get(admissionId) : undefined
    const a = admissionId != null ? adm.get(admissionId) : undefined
    const currentClaimNo = t?.claim_no ?? null
    let status: CStatus = 'other'
    if (latest.tcode === 'A') status = 'passed'
    else if (latest.tcode === 'C') status = currentClaimNo && latest.claimNo && currentClaimNo !== latest.claimNo ? 'resent' : 'open'
    return {
      key,
      admissionId,
      encounterId: Number(last.encounter_id),
      name: [...sorted].reverse().find((r) => r.patient_name)?.patient_name ?? null,
      hn: a?.hn ?? null,
      dischargeDate: a?.discharge_date ? a.discharge_date.slice(0, 10) : null,
      coverageCode: a?.coverage_code ?? last.coverage_code,
      payerId: a?.payer_id ?? last.payer_id,
      currentClaimNo,
      submissionDate: t?.submission_date ? t.submission_date.slice(0, 10) : null,
      rounds,
      lastC,
      latest,
      cRounds: rounds.filter((r) => r.tcode === 'C').length,
      status,
      daysOpen: status === 'open' ? Math.max(dayDiff(lastC.issueDate, today), 0) : null,
    }
  }

  const out: CCase[] = []
  const byAdm = new Map<number, RawItem[]>()
  for (const h of hist) byAdm.set(Number(h.admission_id), [...(byAdm.get(Number(h.admission_id)) ?? []), h])
  for (const [adm_id, items] of byAdm) out.push(build(`a${adm_id}`, items))
  // C ที่จับคู่เคสไม่ได้ (ไม่ควรเกิด) — ยังต้องเห็น ไม่ข้ามเงียบ ๆ
  for (const c of cItems.filter((x) => x.admission_id == null)) out.push(build(`i${c.id}`, [c]))
  return out
}

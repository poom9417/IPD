/**
 * ตัวกรองกลางของหน้า Code C และหน้า "ผลตอบกลับ REP"
 * สิทธิ / ผู้จ่าย เลือกได้หลายค่า · วันที่ 3 ชนิดเป็นช่วง จาก–ถึง (ISO ค.ศ.)
 * กติกาช่วงวันที่ (ตรงกับตัวกรองหน้าหลัก): เลือกแค่ "จาก" = วันนั้นวันเดียว · เลือกครบสองช่อง = ช่วง · เลือกแค่ "ถึง" = ถึงวันนั้น
 */
export interface RepFilters {
  coverages: string[]
  payers: string[]
  dischargeFrom: string
  dischargeTo: string
  submitFrom: string
  submitTo: string
  replyFrom: string
  replyTo: string
}

export const EMPTY_FILTERS: RepFilters = {
  coverages: [],
  payers: [],
  dischargeFrom: '',
  dischargeTo: '',
  submitFrom: '',
  submitTo: '',
  replyFrom: '',
  replyTo: '',
}

export interface Filterable {
  coverageCode: string | null
  payerId: string | null
  dischargeDate: string | null
  submissionDate: string | null
  /** วันที่กองทุนตอบกลับ (วันที่ออกรายงาน REP) */
  replyDate: string | null
}

export function inRange(date: string | null, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!date) return false
  const d = date.slice(0, 10)
  if (from && !to) return d === from
  if (!from && to) return d <= to
  return d >= from && d <= to
}

export function matchFilters(x: Filterable, f: RepFilters): boolean {
  if (f.coverages.length > 0 && !(x.coverageCode && f.coverages.includes(x.coverageCode))) return false
  if (f.payers.length > 0 && !(x.payerId && f.payers.includes(x.payerId))) return false
  return (
    inRange(x.dischargeDate, f.dischargeFrom, f.dischargeTo) &&
    inRange(x.submissionDate, f.submitFrom, f.submitTo) &&
    inRange(x.replyDate, f.replyFrom, f.replyTo)
  )
}

export function hasFilters(f: RepFilters): boolean {
  return JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS)
}

/** คู่ สิทธิ × ผู้จ่าย ที่มีอยู่ในข้อมูลของหน้านั้น — ใช้ทำตัวเลือก (ผู้จ่ายเปลี่ยนตามสิทธิที่เลือก) */
export interface PairOption {
  coverageCode: string
  payerId: string
}

export function pairsOf(items: { coverageCode: string | null; payerId: string | null }[]): PairOption[] {
  const seen = new Set<string>()
  const out: PairOption[] = []
  for (const i of items) {
    if (!i.coverageCode || !i.payerId) continue
    const k = `${i.coverageCode}|${i.payerId}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push({ coverageCode: i.coverageCode, payerId: i.payerId })
    }
  }
  return out
}

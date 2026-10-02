import type { Admission } from './types'

// ---- คำนวณระยะเวลาส่งเบิก ----
// นับเป็น "วันตามปฏิทิน" (ตัดเวลาออก) กันเลื่อนเพราะ timezone — ใช้หลักเดียวกับคอลัมน์ aging ในตาราง

export function dayNumber(ymd: string | null | undefined): number | null {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null
}

export function todayDayNumber(): number {
  const n = new Date()
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86_400_000
}

/** จุดเริ่มนับระยะเวลา (ปลายทางคือ "วันส่งเบิก" เสมอ) */
export type TimingBasis = 'discharge' | 'document' | 'audit'

export const BASIS_LABELS: Record<TimingBasis, string> = {
  discharge: 'จำหน่าย → ส่งเบิก',
  document: 'รับเอกสาร → ส่งเบิก',
  audit: 'Audit → ส่งเบิก',
}

export interface CaseTiming {
  admission: Admission
  /** วันตามปฏิทินของแต่ละขั้น (null = ยังไม่มี) */
  discharge: number | null
  document: number | null
  audit: number | null
  submission: number | null
  /** จำนวนวันตาม basis ที่เลือก — ส่งเบิกแล้ว = วันส่งเบิก − จุดเริ่ม, ยังไม่ส่ง = วันนี้ − จุดเริ่ม */
  days: number | null
  submitted: boolean
  /** ข้อมูลผิดปกติ: วันส่งเบิกมาก่อนจุดเริ่ม (ติดลบ) — ไม่นับในค่าสถิติ */
  invalid: boolean
  /** ระยะเวลาแต่ละช่วง (เฉพาะเมื่อมีวันครบทั้งสองฝั่ง และไม่ติดลบ) */
  stageDischargeDoc: number | null
  stageDocAudit: number | null
  stageAuditSubmit: number | null
}

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  const d = b - a
  return d >= 0 ? d : null
}

export function computeTiming(a: Admission, basis: TimingBasis, today: number): CaseTiming {
  const ct = a.case_tracking
  const discharge = dayNumber(a.discharge_date)
  const document = dayNumber(ct?.document_received_date)
  const audit = dayNumber(ct?.audit_date)
  const submission = dayNumber(ct?.submission_date)
  const start = basis === 'discharge' ? discharge : basis === 'document' ? document : audit
  const submitted = submission !== null

  let days: number | null = null
  let invalid = false
  if (start !== null) {
    days = (submitted ? submission : today) - start
    if (days < 0) {
      invalid = true
      days = null
    }
  }

  return {
    admission: a,
    discharge,
    document,
    audit,
    submission,
    days,
    submitted,
    invalid,
    stageDischargeDoc: diff(discharge, document),
    stageDocAudit: diff(document, audit),
    stageAuditSubmit: diff(audit, submission),
  }
}

export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function fmt1(n: number | null): string {
  return n === null ? '—' : (Math.round(n * 10) / 10).toLocaleString('th-TH')
}

/** ช่วงอายุ (วัน) สำหรับ histogram — ใช้ทั้งเคสที่ส่งแล้วและเคสค้าง */
export const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–7', min: 0, max: 7 },
  { label: '8–14', min: 8, max: 14 },
  { label: '15–30', min: 15, max: 30 },
  { label: '31–60', min: 31, max: 60 },
  { label: '>60', min: 61, max: Infinity },
]

export function bucketCounts(days: number[]): { label: string; value: number }[] {
  return BUCKETS.map((b) => ({
    label: b.label,
    value: days.filter((d) => d >= b.min && d <= b.max).length,
  }))
}

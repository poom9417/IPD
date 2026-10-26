import * as XLSX from 'xlsx'
import { getClaimStage, CLAIM_STAGE_LABELS } from './claimStatus'
import type { Admission } from './types'

type Row = Record<string, unknown>
type Cell = string | number | null | undefined

// ค่าว่าง/null/'' → undefined เพื่อให้ไม่เขียนเซลล์นั้นลงไฟล์ (เป็นช่องว่างจริง)
// ห้ามคืน '' เพราะจะเขียนเป็นสตริงความยาว 0 ซึ่งทำให้ Excel บางฟังก์ชัน (เช่น Text to Columns) เด้งออก
// เลข 0 ยังคงเป็น 0
const v = (x: Cell) => (x === null || x === undefined || x === '' ? undefined : x)

const HEADERS = [
  'HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'วันเกิด', 'วันที่แอดมิท', 'เวลาแอดมิท', 'วันที่จำหน่าย', 'เวลาจำหน่าย',
  'หอผู้ป่วย', 'LOS', 'สิทธิการรักษา', 'ผู้จ่าย', 'วันที่รับเอกสาร', 'ยอดรับเอกสาร', 'วันที่Audit', 'วันที่ส่งเบิก',
  'ยอดส่งเบิก', 'claim_no', 'admission_id', 'coverage_code', 'payer_id', 'hospital_status_code', 'สถานะเคลม',
]

// role audit: ส่งออกเฉพาะ 7 คอลัมน์นี้ (เรียงตามนี้)
const AUDIT_HEADERS = ['HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'coverage_code', 'payer_id', 'วันที่จำหน่าย']

// ส่งออกเฉพาะรายการที่ส่งเข้ามา (Dashboard ส่ง `filtered` = ตามตัวกรองบนหน้าจอ; ถ้าไม่ได้กรองอะไรก็คือทั้งหมด)
// เรียงตามลำดับเดียวกับที่เห็นบนหน้าจอ
export function exportAdmissionsToExcel(
  admissions: Admission[],
  fileName = 'ipd-ar-discharge',
  opts: { auditOnly?: boolean; role?: string | null } = {},
): { admissions: number } {
  // viewer ห้ามส่งออกข้อมูล (กันไว้อีกชั้นนอกเหนือจากการซ่อนปุ่มที่หน้าจอ)
  if (opts.role === 'viewer') throw new Error('role ผู้ดูข้อมูล (viewer) ไม่มีสิทธิ์ Export')
  const headers = opts.auditOnly ? AUDIT_HEADERS : HEADERS
  const rows: Row[] = admissions.map((a) => {
    const ct = a.case_tracking
    return {
      HN: a.hn,
      AN: a.an,
      encounter_id: a.encounter_id,
      ชื่อผู้ป่วย: v(a.patients?.full_name),
      วันเกิด: v(a.patients?.birthdate),
      วันที่แอดมิท: v(a.admit_date),
      เวลาแอดมิท: v(a.admit_time),
      วันที่จำหน่าย: v(a.discharge_date),
      เวลาจำหน่าย: v(a.discharge_time),
      หอผู้ป่วย: v(a.division_code),
      LOS: v(a.los),
      สิทธิการรักษา: v(a.coverage_master?.coverage_name),
      ผู้จ่าย: v(a.payer_master?.payer_name),
      วันที่รับเอกสาร: v(ct?.document_received_date),
      ยอดรับเอกสาร: v(ct?.document_received_amount),
      วันที่Audit: v(ct?.audit_date),
      วันที่ส่งเบิก: v(ct?.submission_date),
      ยอดส่งเบิก: v(ct?.submission_amount),
      claim_no: v(ct?.claim_no),
      admission_id: a.admission_id,
      coverage_code: a.coverage_code,
      payer_id: a.payer_id,
      hospital_status_code: v(a.hospital_status_code),
      สถานะเคลม: CLAIM_STAGE_LABELS[getClaimStage(a)],
    }
  })

  // json_to_sheet จะต่อคีย์ที่ไม่อยู่ใน header ท้ายตารางเอง → ตัดให้เหลือเฉพาะคอลัมน์ที่ต้องการก่อน
  const outRows = rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h]])))
  const ws = XLSX.utils.json_to_sheet(outRows, { header: headers })
  ws['!cols'] = headers.map((h) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length)
    return { wch: Math.min(Math.max(longest + 2, 10), 60) }
  })
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'IPD AR Discharge')

  const stamp = new Date().toISOString().slice(0, 10)
  // bookSST: เก็บข้อความแบบ shared strings เหมือนไฟล์ที่ Excel สร้างเอง (ค่าเริ่มต้นของ SheetJS เขียนเป็น t="str" ซึ่งไม่ใช่รูปแบบปกติ)
  XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`, { bookSST: true })
  return { admissions: rows.length }
}

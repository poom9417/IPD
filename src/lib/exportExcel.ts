import { getClaimStage, CLAIM_STAGE_LABELS } from './claimStatus'
import type { Admission } from './types'

// สร้างไฟล์ด้วย ExcelJS (ไม่ใช่ SheetJS): SheetJS เขียน styles.xml/metadata.xml แบบที่ทำให้ Excel บางเครื่อง
// เด้งออกตอนใช้ Data > Text to Columns ทั้งคอลัมน์ — ExcelJS เขียนโครงสร้างเหมือนที่ Excel สร้างเอง จึงใช้ได้ปกติ
// (โหลดแบบ dynamic import เพราะไลบรารีค่อนข้างใหญ่ ใช้เฉพาะตอนกดปุ่ม Export)

type CellValue = string | number | null | undefined

// ค่าว่าง/null/'' → null เพื่อให้เซลล์นั้นว่างจริง (ไม่ใช่สตริงความยาว 0) ส่วนเลข 0 ยังคงเป็น 0
const v = (x: CellValue) => (x === null || x === undefined || x === '' ? null : x)

// ตัวระบุ (encounter_id / AN) ส่งออกเป็นข้อความ เพื่อใช้ lookup กับไฟล์อื่นที่เก็บเป็นข้อความได้ทันที
const asText = (x: CellValue) => (x === null || x === undefined || x === '' ? null : String(x))

export const HEADERS = [
  'HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'วันเกิด', 'วันที่แอดมิท', 'เวลาแอดมิท', 'วันที่จำหน่าย', 'เวลาจำหน่าย',
  'หอผู้ป่วย', 'LOS', 'สิทธิการรักษา', 'ผู้จ่าย', 'วันที่รับเอกสาร', 'ยอดรับเอกสาร', 'วันที่Audit', 'วันที่ส่งเบิก',
  'ยอดส่งเบิก', 'claim_no', 'admission_id', 'coverage_code', 'payer_id', 'hospital_status_code', 'สถานะเคลม',
]

// role audit: ส่งออกเฉพาะ 7 คอลัมน์นี้ (เรียงตามนี้)
export const AUDIT_HEADERS = ['HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'coverage_code', 'payer_id', 'วันที่จำหน่าย']

type ExportOpts = { auditOnly?: boolean; role?: string | null }
export type ExcelNs = typeof import('exceljs')

export async function loadExcelJS(): Promise<ExcelNs> {
  const mod = (await import('exceljs')) as ExcelNs & { default?: ExcelNs }
  return mod.Workbook ? mod : (mod.default as ExcelNs)
}

// แถวหนึ่งของ Export (ใช้ร่วมกับ Export ของโหมด Dashboard)
export function admissionRecord(a: Admission): Record<string, string | number | null> {
  const ct = a.case_tracking
  return {
    HN: asText(a.hn),
    AN: asText(a.an),
    encounter_id: asText(a.encounter_id),
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
}

// สร้าง workbook (แยกจากการดาวน์โหลด เพื่อให้ทดสอบได้)
export async function buildAdmissionsWorkbook(admissions: Admission[], opts: ExportOpts = {}) {
  // viewer ห้ามส่งออกข้อมูล (กันไว้อีกชั้นนอกเหนือจากการซ่อนปุ่มที่หน้าจอ)
  if (opts.role === 'viewer') throw new Error('role ผู้ดูข้อมูล (viewer) ไม่มีสิทธิ์ Export')
  const { Workbook } = await loadExcelJS()
  const headers = opts.auditOnly ? AUDIT_HEADERS : HEADERS

  const rows = admissions.map(admissionRecord)

  const wb = new Workbook()
  const ws = wb.addWorksheet('IPD AR Discharge')
  ws.addRow(headers)
  for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? null))

  headers.forEach((h, i) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length)
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 60)
  })
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } }
  }
  return { wb, count: rows.length }
}

// ส่งออกเฉพาะรายการที่ส่งเข้ามา (Dashboard ส่ง `filtered` = ตามตัวกรองบนหน้าจอ; ถ้าไม่ได้กรองอะไรก็คือทั้งหมด)
// เรียงตามลำดับเดียวกับที่เห็นบนหน้าจอ
export async function exportAdmissionsToExcel(
  admissions: Admission[],
  fileName = 'ipd-ar-discharge',
  opts: ExportOpts = {},
): Promise<{ admissions: number }> {
  const { wb, count } = await buildAdmissionsWorkbook(admissions, opts)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const stamp = new Date().toISOString().slice(0, 10)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}-${stamp}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { admissions: count }
}

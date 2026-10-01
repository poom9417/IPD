import * as XLSX from 'xlsx'
import type { Admission } from './types'

function fmt(d: string | null | undefined) {
  return d ?? ''
}

export function exportAdmissionsToExcel(admissions: Admission[], fileName = 'ipd-ar-discharge') {
  const rows = admissions.map((a) => ({
    HN: a.hn,
    AN: a.an,
    encounter_id: a.encounter_id,
    ชื่อผู้ป่วย: a.patients?.full_name ?? '',
    วันเกิด: fmt(a.patients?.birthdate),
    วันที่แอดมิท: fmt(a.admit_date),
    เวลาแอดมิท: fmt(a.admit_time),
    วันที่จำหน่าย: fmt(a.discharge_date),
    เวลาจำหน่าย: fmt(a.discharge_time),
    หอผู้ป่วย: a.division_code ?? '',
    LOS: a.los ?? '',
    สิทธิการรักษา: a.coverage_master?.coverage_name ?? '',
    ผู้จ่าย: a.payer_master?.payer_name ?? '',
    วันที่รับเอกสาร: fmt(a.case_tracking?.document_received_date),
    ยอดรับเอกสาร: a.case_tracking?.document_received_amount ?? '',
    วันที่Audit: fmt(a.case_tracking?.audit_date),
    วันที่ส่งเบิก: fmt(a.case_tracking?.submission_date),
    ยอดส่งเบิก: a.case_tracking?.submission_amount ?? '',
    claim_no: a.case_tracking?.claim_no ?? '',
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = Object.keys(rows[0] ?? {}).map((key) => ({ wch: Math.max(key.length + 2, 12) }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'IPD AR Discharge')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${fileName}-${stamp}.xlsx`)
}

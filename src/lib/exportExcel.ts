import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'
import { getClaimStage, CLAIM_STAGE_LABELS } from './claimStatus'
import type { Admission } from './types'

const CHUNK = 1000 // PostgREST คืนสูงสุด 1,000 แถว/คำขอ — ต้องดึงเป็นช่วงๆ ไม่งั้นข้อมูลโดนตัดเงียบๆ

type Row = Record<string, unknown>
type Cell = string | number | null | undefined

const v = (x: Cell) => x ?? '' // ค่าว่างเป็นช่องว่าง ส่วนเลข 0 ยังคงเป็น 0

const HEADERS = [
  'HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'วันเกิด', 'วันที่แอดมิท', 'เวลาแอดมิท', 'วันที่จำหน่าย', 'เวลาจำหน่าย',
  'หอผู้ป่วย', 'LOS', 'สิทธิการรักษา', 'ผู้จ่าย', 'วันที่รับเอกสาร', 'ยอดรับเอกสาร', 'วันที่Audit', 'วันที่ส่งเบิก',
  'ยอดส่งเบิก', 'claim_no', 'admission_id', 'coverage_code', 'payer_id', 'hospital_status_code', 'สถานะเคลม',
]

// ดึง admissions ทุกแถว (แบ่งหน้า) — ไม่ผ่านตัวกรองบนหน้าจอ ไม่จำกัดจำนวน
async function fetchAllAdmissions(): Promise<Admission[]> {
  const all: Admission[] = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('admissions')
      .select('*, patients(*), coverage_master(*), payer_master(*), case_tracking(*)')
      .order('admission_id', { ascending: true })
      .range(from, from + CHUNK - 1)
    if (error) throw new Error(error.message)
    const chunk = (data as unknown as Admission[]) ?? []
    all.push(...chunk)
    if (chunk.length < CHUNK) break
  }
  return all
}

export async function exportAllToExcel(fileName = 'ipd-ar-discharge'): Promise<{ admissions: number }> {
  const admissions = await fetchAllAdmissions()

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

  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS })
  ws['!cols'] = HEADERS.map((h) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length)
    return { wch: Math.min(Math.max(longest + 2, 10), 60) }
  })
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'IPD AR Discharge')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`)
  return { admissions: rows.length }
}

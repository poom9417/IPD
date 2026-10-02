import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'
import { getClaimStage, CLAIM_STAGE_LABELS } from './claimStatus'
import type { Admission, CodeCCase } from './types'

const CHUNK = 1000 // PostgREST คืนสูงสุด 1,000 แถว/คำขอ — ต้องดึงเป็นช่วงๆ ไม่งั้นข้อมูลโดนตัดเงียบๆ

type Row = Record<string, unknown>
type Cell = string | number | null | undefined

// ดึงทุกแถวของตาราง (แบ่งหน้า) — ไม่ผ่านตัวกรองบนหน้าจอ ไม่จำกัดจำนวน
async function fetchAll<T = Row>(table: string, select: string, orderBy: string): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy, { ascending: true })
      .range(from, from + CHUNK - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const chunk = (data as unknown as T[]) ?? []
    all.push(...chunk)
    if (chunk.length < CHUNK) break
  }
  return all
}

const v = (x: Cell) => x ?? '' // ค่าว่างเป็นช่องว่าง ส่วนเลข 0 ยังคงเป็น 0

// timestamptz → "YYYY-MM-DD HH:mm:ss" เวลาท้องถิ่นของเครื่องผู้ใช้
function ts(x: string | null | undefined): string {
  if (!x) return ''
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return x
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function makeSheet(rows: Row[], headers: string[]): XLSX.WorkSheet {
  // header ครบเสมอแม้ไม่มีข้อมูล
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
  ws['!cols'] = headers.map((h) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length)
    return { wch: Math.min(Math.max(longest + 2, 10), 60) }
  })
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}

interface AssignmentRow {
  coverage_code: string
  user_id: string
  user_email: string | null
  created_at: string
}
interface UserRow {
  id: string
  email: string
  role: string
  unit: string | null
  created_at: string
}
interface PatientRow {
  hn: string
  full_name: string
  birthdate: string | null
  created_at: string
  updated_at: string
}
interface CoverageRow {
  coverage_code: string
  coverage_name: string
}
interface PayerRow {
  payer_id: string
  payer_name: string
}
type AdmissionFull = Admission & {
  created_at: string
  updated_at: string
  patients: (Admission['patients'] & { created_at?: string; updated_at?: string }) | null
  case_tracking: (NonNullable<Admission['case_tracking']> & { updated_by: string | null }) | null
}

// ลำดับ 19 คอลัมน์แรก "เหมือนไฟล์เดิมทุกตัวอักษร" (กัน Power Query / สูตรที่อ้างชื่อคอลัมน์พัง)
// คอลัมน์ใหม่ทั้งหมดต่อท้ายหลังจากนั้น
const ADMISSION_HEADERS = [
  'HN', 'AN', 'encounter_id', 'ชื่อผู้ป่วย', 'วันเกิด', 'วันที่แอดมิท', 'เวลาแอดมิท', 'วันที่จำหน่าย', 'เวลาจำหน่าย',
  'หอผู้ป่วย', 'LOS', 'สิทธิการรักษา', 'ผู้จ่าย', 'วันที่รับเอกสาร', 'ยอดรับเอกสาร', 'วันที่Audit', 'วันที่ส่งเบิก',
  'ยอดส่งเบิก', 'claim_no',
  // ---- ต่อท้าย (ใหม่) ----
  'admission_id', 'coverage_code', 'payer_id', 'hospital_status_code', 'สถานะเคลม', 'ผู้ดูแลสิทธิ',
  'แก้ไขเคสล่าสุดโดย', 'แก้ไขเคสล่าสุดเมื่อ', 'ข้อมูลเคสนำเข้าเมื่อ', 'ข้อมูลเคสแก้ไขเมื่อ',
  'ข้อมูลผู้ป่วยสร้างเมื่อ', 'ข้อมูลผู้ป่วยแก้ไขเมื่อ',
  'จำนวนครั้ง Code C', 'Code C ล่าสุด: สาเหตุ', 'Code C ล่าสุด: Deadline', 'Code C ล่าสุด: แจ้งโดย',
  'Code C ล่าสุด: แจ้งเมื่อ', 'Code C ล่าสุด: วิธีแก้ไข', 'Code C ล่าสุด: ตอบโดย', 'Code C ล่าสุด: ตอบเมื่อ',
]

const CODEC_HEADERS = [
  'code_c_id', 'admission_id', 'encounter_id', 'HN', 'ชื่อผู้ป่วย', 'coverage_code', 'สิทธิการรักษา', 'payer_id', 'ผู้จ่าย',
  'วันที่ส่งเบิก', 'claim_no', 'สาเหตุที่ติด C', 'Deadline', 'อีเมลผู้แจ้ง', 'แจ้งเมื่อ',
  'วิธีแก้ไข (Audit)', 'อีเมลผู้ตอบ', 'ตอบเมื่อ',
]

export async function exportAllToExcel(fileName = 'ipd-ar-discharge'): Promise<{ admissions: number }> {
  // ดึงทุกตารางพร้อมกัน — admissions ใช้ join ครั้งเดียว ได้ทุกคอลัมน์ของ patients/สิทธิ/ผู้จ่าย/case_tracking
  const [admissions, codeC, assignments, patients, coverages, payers, usersRes] = await Promise.all([
    fetchAll<AdmissionFull>(
      'admissions',
      '*, patients(*), coverage_master(*), payer_master(*), case_tracking(*)',
      'admission_id',
    ),
    fetchAll<CodeCCase>(
      'code_c_cases',
      '*, admissions(hn, coverage_code, payer_id, patients(full_name), coverage_master(coverage_name), payer_master(payer_name), case_tracking(submission_date, claim_no))',
      'id',
    ),
    fetchAll<AssignmentRow>('coverage_assignments', '*', 'coverage_code'),
    fetchAll<PatientRow>('patients', '*', 'hn'),
    fetchAll<CoverageRow>('coverage_master', '*', 'coverage_code'),
    fetchAll<PayerRow>('payer_master', '*', 'payer_id'),
    // app_users: RLS ให้เห็นทั้งหมดเฉพาะ admin (คนอื่นเห็นแค่ตัวเอง) — ไม่ error ถ้าอ่านไม่ได้
    fetchAll<UserRow>('app_users', '*', 'email').catch(() => [] as UserRow[]),
  ])

  const users = usersRes
  const emailById = new Map(users.map((u) => [u.id, u.email]))
  const ownerByCoverage = new Map(assignments.map((a) => [a.coverage_code, a.user_email ?? emailById.get(a.user_id) ?? a.user_id]))
  // updated_by เป็น uuid — แปลงเป็นอีเมลเมื่อ RLS อนุญาต ถ้าไม่ได้แสดง uuid เดิม (ไม่ทิ้งข้อมูล)
  const who = (id: string | null | undefined) => (id ? (emailById.get(id) ?? id) : '')

  // Code C ต่อ admission (เรียงตามเวลาแจ้ง ล่าสุดอยู่ท้าย)
  const codeCByAdm = new Map<number, CodeCCase[]>()
  for (const c of codeC) {
    const list = codeCByAdm.get(c.admission_id) ?? []
    list.push(c)
    codeCByAdm.set(c.admission_id, list)
  }
  for (const list of codeCByAdm.values()) list.sort((a, b) => a.reason_at.localeCompare(b.reason_at))

  const admissionRows: Row[] = admissions.map((a) => {
    const ct = a.case_tracking
    const cs = codeCByAdm.get(a.admission_id) ?? []
    const last = cs[cs.length - 1]
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
      ผู้ดูแลสิทธิ: ownerByCoverage.get(a.coverage_code) ?? '',
      แก้ไขเคสล่าสุดโดย: who(ct?.updated_by),
      แก้ไขเคสล่าสุดเมื่อ: ts(ct?.updated_at),
      ข้อมูลเคสนำเข้าเมื่อ: ts(a.created_at),
      ข้อมูลเคสแก้ไขเมื่อ: ts(a.updated_at),
      ข้อมูลผู้ป่วยสร้างเมื่อ: ts(a.patients?.created_at),
      ข้อมูลผู้ป่วยแก้ไขเมื่อ: ts(a.patients?.updated_at),
      'จำนวนครั้ง Code C': cs.length,
      'Code C ล่าสุด: สาเหตุ': v(last?.reason),
      'Code C ล่าสุด: Deadline': v(last?.deadline_date),
      'Code C ล่าสุด: แจ้งโดย': v(last?.reason_by_email),
      'Code C ล่าสุด: แจ้งเมื่อ': ts(last?.reason_at),
      'Code C ล่าสุด: วิธีแก้ไข': v(last?.fix_detail),
      'Code C ล่าสุด: ตอบโดย': v(last?.fix_by_email),
      'Code C ล่าสุด: ตอบเมื่อ': ts(last?.fix_at),
    }
  })

  const codeCRows: Row[] = codeC.map((c) => ({
    code_c_id: c.id,
    admission_id: c.admission_id,
    encounter_id: c.encounter_id,
    HN: v(c.admissions?.hn),
    ชื่อผู้ป่วย: v(c.admissions?.patients?.full_name),
    coverage_code: v(c.admissions?.coverage_code),
    สิทธิการรักษา: v(c.admissions?.coverage_master?.coverage_name),
    payer_id: v(c.admissions?.payer_id),
    ผู้จ่าย: v(c.admissions?.payer_master?.payer_name),
    วันที่ส่งเบิก: v(c.admissions?.case_tracking?.submission_date),
    claim_no: v(c.admissions?.case_tracking?.claim_no),
    'สาเหตุที่ติด C': c.reason,
    Deadline: c.deadline_date,
    อีเมลผู้แจ้ง: v(c.reason_by_email),
    แจ้งเมื่อ: ts(c.reason_at),
    'วิธีแก้ไข (Audit)': v(c.fix_detail),
    อีเมลผู้ตอบ: v(c.fix_by_email),
    ตอบเมื่อ: ts(c.fix_at),
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, makeSheet(admissionRows, ADMISSION_HEADERS), 'IPD AR Discharge') // ชื่อชีตเดิม
  XLSX.utils.book_append_sheet(wb, makeSheet(codeCRows, CODEC_HEADERS), 'Code C')

  const assignmentHeaders = ['coverage_code', 'สิทธิการรักษา', 'ผู้ดูแล (อีเมล)', 'user_id', 'เลือกเมื่อ']
  const covName = new Map(coverages.map((c) => [c.coverage_code, c.coverage_name]))
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      assignments.map((a) => ({
        coverage_code: a.coverage_code,
        สิทธิการรักษา: covName.get(a.coverage_code) ?? '',
        'ผู้ดูแล (อีเมล)': v(a.user_email ?? emailById.get(a.user_id)),
        user_id: a.user_id,
        เลือกเมื่อ: ts(a.created_at),
      })),
      assignmentHeaders,
    ),
    'ผู้ดูแลสิทธิ',
  )

  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      patients.map((p) => ({
        HN: p.hn,
        ชื่อผู้ป่วย: p.full_name,
        วันเกิด: v(p.birthdate),
        สร้างเมื่อ: ts(p.created_at),
        แก้ไขเมื่อ: ts(p.updated_at),
      })),
      ['HN', 'ชื่อผู้ป่วย', 'วันเกิด', 'สร้างเมื่อ', 'แก้ไขเมื่อ'],
    ),
    'ผู้ป่วย',
  )
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(coverages.map((c) => ({ ...c })), ['coverage_code', 'coverage_name']),
    'สิทธิ',
  )
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(payers.map((p) => ({ ...p })), ['payer_id', 'payer_name']),
    'ผู้จ่าย',
  )
  // ผู้ใช้งานระบบ: ใส่เมื่อมีสิทธิ์เห็นมากกว่าตัวเอง (admin)
  if (users.length > 1) {
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(
        users.map((u) => ({ email: u.email, role: u.role, unit: v(u.unit), สร้างเมื่อ: ts(u.created_at), user_id: u.id })),
        ['email', 'role', 'unit', 'สร้างเมื่อ', 'user_id'],
      ),
      'ผู้ใช้งาน',
    )
  }

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`)
  return { admissions: admissionRows.length }
}

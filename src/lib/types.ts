/** role จริงที่เก็บใน DB (developer = admin + จำลอง role ได้ ตั้งได้ผ่าน DB เท่านั้น) */
export type AppRole = 'admin' | 'user' | 'viewer' | 'audit' | 'developer'
/** role ที่ใช้ตัดสินหน้าจอ/ปุ่ม — developer จะถูกแปลงเป็น admin หรือ role ที่กำลังจำลอง */
export type UiRole = Exclude<AppRole, 'developer'>

export interface Patient {
  hn: string
  full_name: string
  birthdate: string | null
}

export interface CoverageMaster {
  coverage_code: string
  coverage_name: string
}

export interface PayerMaster {
  payer_id: string
  payer_name: string
}

export interface CaseTracking {
  admission_id: number
  encounter_id: number
  document_received_date: string | null
  document_received_amount: number | null
  audit_date: string | null
  submission_date: string | null
  submission_amount: number | null
  claim_no: string | null
  updated_at: string
}

export interface AppUser {
  id: string
  email: string
  role: AppRole
  unit: string | null
  created_at: string
}

export interface Admission {
  admission_id: number
  encounter_id: number
  an: number
  hn: string
  admit_date: string
  admit_time: string | null
  discharge_date: string | null
  discharge_time: string | null
  division_code: string | null
  hospital_status_code: number | null
  los: number | null
  coverage_code: string
  payer_id: string
  patients: Patient | null
  coverage_master: CoverageMaster | null
  payer_master: PayerMaster | null
  case_tracking: CaseTracking | null
}

export type BulkStage = 'document' | 'audit' | 'submission'

export interface BulkRow {
  encounter_id: number
  date: string
  amount?: number
}

export interface CaseTrackingDraft {
  document_received_date: string
  document_received_amount: string
  audit_date: string
  submission_date: string
  submission_amount: string
  claim_no: string
}

export interface AdmissionDraft {
  encounter_id: number | ''
  an: number | ''
  hn: string
  full_name: string
  birthdate: string
  admit_date: string
  admit_time: string
  discharge_date: string
  discharge_time: string
  division_code: string
  los: number | ''
  coverage_code: string
  payer_id: string
}

// ---- Code C (เคสที่ส่งเบิกแล้วแต่ติด C) ----
export interface CodeCHistory {
  id: number
  round_no: number
  kind: 'reason' | 'answer' | 'edit' | 'reopen'
  body: string | null
  prev_body: string | null
  by_email: string | null
  at: string
}

export interface CodeCCase {
  id: number
  admission_id: number
  encounter_id: number
  reason: string
  deadline_date: string
  reason_by: string | null
  reason_by_email: string | null
  reason_at: string
  fix_detail: string | null
  fix_by: string | null
  fix_by_email: string | null
  fix_at: string | null
  /** pending = รอ Audit แก้ไข · answered = Audit ตอบแล้ว (ถือว่าผ่านอัตโนมัติจนกว่า user จะกด "ไม่ผ่านการแก้ C") */
  status: 'pending' | 'answered'
  round_no: number
  /** true = dateline ระบบคำนวณเอง (วันจำหน่าย + 7) · false = เคสเก่าที่ user กรอกเอง */
  auto_deadline: boolean
  code_c_history: CodeCHistory[] | null
  admissions: {
    hn: string
    discharge_date: string | null
    coverage_code: string
    payer_id: string
    patients: { full_name: string } | null
    coverage_master: { coverage_name: string } | null
    payer_master: { payer_name: string } | null
    case_tracking: { submission_date: string | null; claim_no: string | null } | null
  } | null
}

// ---- My job (ใครดูแลสิทธิไหน) ----
export interface CoverageAssignment {
  coverage_code: string
  payer_id: string
  user_id: string
  user_email: string | null
}

// สิทธิ + ผู้จ่าย (payer) ที่มีอยู่จริงในข้อมูลเคส — หน่วยที่ใช้กำหนดผู้ดูแลในหน้า My claim
export interface CoveragePayerPair {
  coverage_code: string
  payer_id: string
  coverage_name: string | null
  payer_name: string | null
  case_count: number
}

export interface DivisionMaster {
  division_code: string
  division_name: string | null
}

export type AppRole = 'admin' | 'viewer'

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

export interface Admission {
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
  coverage_code: string | null
  payer_id: string | null
  patients: Patient | null
  coverage_master: CoverageMaster | null
  payer_master: PayerMaster | null
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

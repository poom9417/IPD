import { supabase } from './supabaseClient'
import type { Admission } from './types'

// ชื่อผู้ป่วย / วันเกิด / ยอดเงิน ถูกปิดไม่ให้อ่านจากตารางจริงโดยตรง (ปิดบังตาม role ที่ฐานข้อมูล)
// — อ่านผ่าน view patients_v / case_tracking_v และเขียนผ่านฟังก์ชัน save_patient / upsert_case_tracking เท่านั้น

export type CaseTrackingRow = Record<string, string | number | null> & { admission_id: number }

/** บันทึกสถานะเคลมแบบ upsert (ส่งเฉพาะฟิลด์ที่ต้องการแก้, ส่ง null = ล้างค่า) — คืนจำนวนแถวที่บันทึก */
export async function saveCaseTracking(rows: CaseTrackingRow[]): Promise<number> {
  const { data, error } = await supabase.rpc('upsert_case_tracking', { p_rows: rows })
  if (error) throw error
  return (data as number | null) ?? rows.length
}

/** อ่านแถวสถานะเคลมของเคสเดียว (ปิดบังยอดเงินตาม role) */
export async function fetchCaseTracking(admissionId: number): Promise<Admission['case_tracking']> {
  const { data, error } = await supabase
    .from('case_tracking_v')
    .select('*')
    .eq('admission_id', admissionId)
    .maybeSingle()
  if (error) throw error
  return (data as Admission['case_tracking']) ?? null
}

/** บันทึกผู้ป่วย — admin แก้ได้, user เพิ่ม HN ใหม่ได้อย่างเดียว */
export async function savePatient(hn: string, fullName: string, birthdate: string | null): Promise<void> {
  const { error } = await supabase.rpc('save_patient', {
    p_hn: hn,
    p_full_name: fullName,
    p_birthdate: birthdate,
  })
  if (error) throw error
}

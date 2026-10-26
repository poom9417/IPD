import { supabase } from './supabaseClient'
import type { Admission } from './types'
import type { ClaimStage } from './claimStatus'

// ตัวกรองของหน้า Dashboard — ส่งไปให้ฟังก์ชัน search_admissions ใน DB กรอง/เรียง/แบ่งหน้าให้
export interface AdmissionFilters {
  search: string
  division: string
  /** วันจำหน่าย (YYYY-MM-DD) — เลือกวันเดียวให้ from = to */
  from: string
  to: string
  coverages: string[]
  payer: string
  stage: ClaimStage | ''
  /** 'สิทธิ|ผู้จ่าย' ของ "เฉพาะสิทธิของฉัน" — null = ไม่กรอง */
  pairs: string[] | null
}

export interface AdmissionStats {
  cases: number
  avg_los: number
  patients: number
  received_total: number
  received_count: number
}

export interface SearchResult {
  total: number
  grand_total: number
  rows: Admission[]
  stats: AdmissionStats | null
  divisions: string[] | null
}

// เรียงวันจำหน่ายใหม่ → เก่า (วันเดียวกันเรียงตามเวลาจำหน่าย แล้วตาม admission_id)
export async function searchAdmissions(
  f: AdmissionFilters,
  limit: number,
  offset: number,
  withStats = true,
): Promise<SearchResult> {
  const { data, error } = await supabase.rpc('search_admissions', {
    p_search: f.search || null,
    p_division: f.division || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_coverages: f.coverages.length ? f.coverages : null,
    p_payer: f.payer || null,
    p_stage: f.stage || null,
    p_pairs: f.pairs,
    p_limit: limit,
    p_offset: offset,
    p_with_stats: withStats,
  })
  if (error) throw error
  return data as unknown as SearchResult
}

const EXPORT_CHUNK = 1000

// ดึงทุกแถวที่ตรงตัวกรอง (ใช้ตอน Export)
// เดิมยิงหลายก้อนขนานด้วย offset ผ่าน search_admissions (ทุกก้อนต้องกรอง/นับทั้งตารางซ้ำ) → บางครั้งเกินเวลา query ของฐานข้อมูล
// ตอนนี้ใช้ export_admissions ดึงทีละก้อนตามลำดับ admission_id (keyset: ก้อนถัดไปเริ่มหลัง id สุดท้าย) ทีละคำสั่ง
// แล้วเรียงกลับเป็นลำดับเดียวกับหน้าจอ (วันจำหน่ายใหม่ → เก่า)
export async function fetchAllMatching(f: AdmissionFilters): Promise<Admission[]> {
  const rows: Admission[] = []
  let after = 0
  for (;;) {
    const { data, error } = await supabase.rpc('export_admissions', {
      p_search: f.search || null,
      p_division: f.division || null,
      p_from: f.from || null,
      p_to: f.to || null,
      p_coverages: f.coverages.length ? f.coverages : null,
      p_payer: f.payer || null,
      p_stage: f.stage || null,
      p_pairs: f.pairs,
      p_after: after,
      p_limit: EXPORT_CHUNK,
    })
    if (error) throw error
    const part = (data ?? []) as unknown as Admission[]
    rows.push(...part)
    if (part.length < EXPORT_CHUNK) break
    after = part[part.length - 1].admission_id
  }
  // ลำดับเดียวกับ search_admissions: วันจำหน่าย ↓ → เวลาจำหน่าย ↓ → admission_id ↓ (ค่าว่างไว้ท้าย)
  const cmpDesc = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? 1 : -1)
  return rows.sort(
    (x, y) =>
      cmpDesc(x.discharge_date, y.discharge_date) ||
      cmpDesc(x.discharge_time, y.discharge_time) ||
      y.admission_id - x.admission_id,
  )
}

// รายการแบบเบา (admission_id, encounter_id, payer_id) ไว้จับคู่ไฟล์อัพโหลดสถานะเคลม — ดึงตอนเปิดหน้าอัพโหลดเท่านั้น
export async function fetchAdmissionLookup(): Promise<Admission[]> {
  const CHUNK = 1000
  const head = await supabase.from('admissions').select('admission_id', { count: 'exact', head: true })
  if (head.error) throw head.error
  const total = head.count ?? 0
  const offsets: number[] = []
  for (let o = 0; o < total; o += CHUNK) offsets.push(o)
  const parts = await Promise.all(
    offsets.map(async (o) => {
      const { data, error } = await supabase
        .from('admissions')
        .select('admission_id, encounter_id, payer_id')
        .order('admission_id')
        .range(o, o + CHUNK - 1)
      if (error) throw error
      return (data ?? []) as unknown as Admission[]
    }),
  )
  return parts.flat()
}

import * as XLSX from 'xlsx'

/**
 * อ่านไฟล์ "ตั้งเบิก ประเภทออกใบแจ้งหนี้ สิทธิ GGO" (.xls จากระบบเบิก) แล้วแปลงเป็นข้อมูลที่ตรงกับ DB ของเรา
 * ไม่แก้โครงสร้าง DB — แค่แปลงชื่อคอลัมน์/รูปแบบก่อนบันทึกลง case_tracking
 *
 *   enc_id        → encounter_id
 *   payer         → payer_id
 *   claim_no      → claim_no
 *   dateclaim     → submission_date   (แปลง "1 กย 2569" เป็น 2026-09-01)
 *   claim_amount  → submission_amount
 *   claimcancel   → ถ้ามี "X" = เคสยกเลิก ไม่นับเป็นการส่งเบิก
 */
export interface GgoClaimRow {
  /** เลขแถวใน Excel (หัวตารางคือแถว 1) */
  line: number
  encounterId: number
  payerId: string
  claimNo: string
  /** YYYY-MM-DD (ค.ศ.) หรือ null ถ้าอ่านวันที่ไม่ได้ */
  claimDate: string | null
  claimDateRaw: string
  claimAmount: number | null
  cancelled: boolean
  name: string
}

const REQUIRED_HEADERS = ['enc_id', 'payer', 'claim_no', 'dateclaim', 'claim_amount', 'claimcancel']

const THAI_MONTHS: Record<string, number> = {
  // ตัวย่อ (ไม่มีจุด)
  มค: 1, กพ: 2, มีค: 3, เมย: 4, พค: 5, มิย: 6, กค: 7, สค: 8, กย: 9, ตค: 10, พย: 11, ธค: 12,
  // ชื่อเต็ม
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
}

/**
 * ไฟล์ .xls นี้ไม่มีข้อมูล codepage ทำให้ตัวอักษรไทย (TIS-620/cp874) ถูกอ่านเป็นภาษาละติน (เช่น "¡Â" แทน "กย")
 * แปลงกลับ: byte 0xA1–0xFB ของ cp874 = U+0E01–U+0E5B (บวก 0x0D60)
 * ถ้าข้อความเป็นภาษาไทยถูกต้องอยู่แล้ว จะไม่แตะต้อง
 */
export function fixThaiText(s: string): string {
  if (!s || /[\u0E00-\u0E7F]/.test(s)) return s
  if (![...s].every((c) => c.charCodeAt(0) <= 0xff)) return s
  if (![...s].some((c) => c.charCodeAt(0) >= 0xa1)) return s
  return [...s]
    .map((c) => {
      const code = c.charCodeAt(0)
      return code >= 0xa1 && code <= 0xfb ? String.fromCharCode(code + 0x0d60) : c
    })
    .join('')
}

function toIso(y: number, m: number, d: number): string | null {
  if (y > 2400) y -= 543 // พ.ศ. → ค.ศ.
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** รองรับ "1 กย 2569", "1 ก.ย. 2569", "1 กันยายน 2569", 2026-09-01, 01/09/2569, ตัวเลขวันที่ Excel และ Date */
export function parseClaimDate(value: unknown): { iso: string | null; raw: string } {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const iso = toIso(value.getFullYear(), value.getMonth() + 1, value.getDate())
    return { iso, raw: iso ?? String(value) }
  }
  if (typeof value === 'number') {
    // ตัวเลขวันที่แบบ Excel (นับวันจาก 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
    return { iso: toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), raw: String(value) }
  }
  const raw = fixThaiText(String(value ?? '')).trim()
  if (!raw) return { iso: null, raw }

  let m = raw.match(/^(\d{1,2})[\s/-]*([\u0E00-\u0E7F.]+)[\s/-]*(\d{4})$/)
  if (m) {
    const month = THAI_MONTHS[m[2].replace(/\./g, '')]
    return { iso: month ? toIso(Number(m[3]), month, Number(m[1])) : null, raw }
  }
  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return { iso: toIso(Number(m[1]), Number(m[2]), Number(m[3])), raw }
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return { iso: toIso(Number(m[3]), Number(m[2]), Number(m[1])), raw }
  return { iso: null, raw }
}

function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return isFinite(n) ? n : null
}

export async function parseGgoClaimFile(file: File): Promise<GgoClaimRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('ไม่พบ sheet ในไฟล์')

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true })
  if (json.length === 0) throw new Error('ไฟล์ไม่มีข้อมูล')

  // ชื่อหัวคอลัมน์: ตัดช่องว่าง + ตัวพิมพ์เล็ก
  const norm = (r: Record<string, unknown>) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) o[k.trim().toLowerCase()] = v
    return o
  }
  const first = norm(json[0])
  const missing = REQUIRED_HEADERS.filter((h) => !(h in first))
  if (missing.length > 0) {
    throw new Error(`ไฟล์ไม่ใช่รูปแบบที่รองรับ — ไม่พบคอลัมน์: ${missing.join(', ')}`)
  }

  return json.map((r0, i) => {
    const r = norm(r0)
    const { iso, raw } = parseClaimDate(r['dateclaim'])
    return {
      line: i + 2,
      encounterId: Number(String(r['enc_id'] ?? '').trim()),
      payerId: String(r['payer'] ?? '').trim(),
      claimNo: String(r['claim_no'] ?? '').trim(),
      claimDate: iso,
      claimDateRaw: raw,
      claimAmount: parseAmount(r['claim_amount']),
      // มี "X" (ไม่สนตัวพิมพ์/ช่องว่าง) = ยกเลิก
      cancelled: String(r['claimcancel'] ?? '').trim().toUpperCase().includes('X'),
      name: fixThaiText(String(r['name'] ?? '')).trim(),
    }
  })
}

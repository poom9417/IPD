// ตัวช่วยสำหรับช่องกรอกวันที่ (dd/mm/yyyy) — ใช้กับ DateInput
// - ภายในระบบเก็บเป็น ISO "YYYY-MM-DD" (ค.ศ.) เสมอ
// - ช่องกรอกแสดงเป็น "วว/ดด/ปปปป" (ค.ศ.)
// - ถ้าผู้ใช้กรอกปี พ.ศ. (>= 2400) จะแปลงเป็น ค.ศ. ให้ทันที

const BE_OFFSET = 543
const BE_MIN = 2400 // ปี ≥ 2400 ถือว่าเป็น พ.ศ.
const CE_MIN = 1900
const CE_MAX = 2200

export interface ParsedDate {
  /** ISO YYYY-MM-DD (ค.ศ.) */
  iso: string
  /** ข้อความที่แสดงในช่อง dd/mm/yyyy (ค.ศ.) */
  text: string
  /** true ถ้าผู้ใช้กรอกเป็น พ.ศ. แล้วถูกแปลง */
  convertedFromBE: boolean
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** ISO YYYY-MM-DD → dd/mm/yyyy ('' ถ้าไม่ใช่ ISO) */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/**
 * อ่านข้อความ "d/m/yyyy" ที่กรอกครบ วัน/เดือน/ปี (ปี 4 หลัก)
 * คืน null ถ้ายังไม่ครบหรือไม่ใช่วันที่จริง
 */
export function parseDisplayDate(text: string): ParsedDate | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  let convertedFromBE = false
  if (y >= BE_MIN) {
    y -= BE_OFFSET
    convertedFromBE = true
  }
  if (y < CE_MIN || y > CE_MAX) return null
  if (!isRealDate(y, mo, d)) return null
  return {
    iso: `${pad(y, 4)}-${pad(mo)}-${pad(d)}`,
    text: `${pad(d)}/${pad(mo)}/${pad(y, 4)}`,
    convertedFromBE,
  }
}

/**
 * จัดรูปข้อความระหว่างพิมพ์ให้เป็น dd/mm/yyyy
 * - พิมพ์แต่ตัวเลขต่อเนื่อง จะเติม "/" ให้เอง
 * - พิมพ์ / - . หรือเว้นวรรคเองได้ (เช่น 6/11/2569)
 * - วางรูปแบบ ISO (2569-11-06 หรือ 2026-11-06) ได้
 * - growing=false (กำลังลบ) จะไม่เติม "/" ท้ายข้อความ เพื่อให้ลบได้
 */
export function formatTyping(raw: string, growing: boolean): string {
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(raw)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`

  if (/[^\d]/.test(raw)) {
    const endsWithSep = /[/\-.\s]$/.test(raw)
    const parts = raw
      .split(/[/\-.\s]+/)
      .map((p) => p.replace(/\D/g, ''))
      .filter((p, i, a) => p !== '' || i < a.length - 1)
      .slice(0, 3)
    // ลบ "/" แล้วพิมพ์ต่อ เช่น 06/112 → ให้ตัวเลขที่เกินไหลไปช่องถัดไป (06/11/2)
    if (parts.length === 2 && parts[1].length > 2) parts.splice(1, 1, parts[1].slice(0, 2), parts[1].slice(2))
    const lim = [2, 2, 4]
    const out = parts.map((p, i) => p.slice(0, lim[i])).join('/')
    const last = parts[parts.length - 1]
    // ช่องวัน/เดือนครบ 2 หลักระหว่างพิมพ์ต่อ → เติม "/" ให้ (ถ้าใส่ / มาเองแล้วก็เติมให้เหมือนกัน)
    const fullSegment = parts.length < 3 && last.length >= 2
    return growing && parts.length < 3 && last !== '' && (endsWithSep || fullSegment) ? out + '/' : out
  }

  const digits = raw.slice(0, 8)
  let out = digits.slice(0, 2)
  if (digits.length >= 3) out += '/' + digits.slice(2, 4)
  if (digits.length >= 5) out += '/' + digits.slice(4, 8)
  if (growing && (digits.length === 2 || digits.length === 4)) out += '/'
  return out
}

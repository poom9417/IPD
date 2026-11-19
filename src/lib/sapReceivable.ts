/**
 * สร้างไฟล์ txt (tab-delimited) สำหรับนำเข้า SAP เพื่อตั้งหนี้จากผลตอบกลับ REP
 * รูปแบบอ้างอิงจากไฟล์ตัวอย่างที่ใช้จริง (47 คอลัมน์, ขึ้นบรรทัดใหม่แบบ CRLF)
 *
 * 1 เคส = 4 บรรทัด (H + L09 + L40 + L11) — กรณีไม่มีส่วนต่างจะไม่มีบรรทัด 40
 *   H   หัวเอกสาร   : วันที่จำหน่าย, วันที่ตอบกลับ, เลข Ref (claim_no)
 *   L09 ยอดที่จ่าย  : บัญชี ACCOUNT_09
 *   L40 ส่วนต่าง    : บัญชี ACCOUNT_40 = HIS − ยอดที่จ่าย (เมื่อ HIS มากกว่า)
 *   L11 ลูกหนี้     : C+HN = ยอด HIS (ยอดรับเอกสาร) — HN เติมศูนย์ให้ครบ 8 หลัก
 *   L09 คอลัมน์ D   : 'C' (เดิม 'E')
 *
 * กติกายอด (ยืนยันกับผู้ใช้ 2026-11-11):
 *   จ่าย < HIS  → 09 = จ่าย,  40 = HIS − จ่าย,  11 = HIS
 *   จ่าย = HIS  → 09 = จ่าย,  ไม่มี 40,         11 = HIS
 *   จ่าย > HIS  → 09 = HIS,   ไม่มี 40,         11 = HIS
 */

export interface SapPayerConfig {
  payerId: string
  /** บัญชีของบรรทัด 09 — ข้อมูลชุด GGO 50257 ใช้ 0030001515 (0030001516 ใช้กับอีกกลุ่มหนึ่ง) */
  account09: string
  /** บัญชีของบรรทัด 40 (ส่วนต่าง) */
  account40: string
  /** ค่าคงที่ที่คอลัมน์ D ของบรรทัด 09 */
  col09Flag: string
  companyCode: string
  profitCenter: string
  /** ค่าในคอลัมน์ I ของบรรทัด 40 */
  col40Ref: string
  docType: string
  currency: string
  /** ค่าคงที่ "IPD" / "GGO" ที่ปรากฏในคอลัมน์ 17-18 และ 32-33 */
  tagA: string
  tagB: string
}

/** ตั้งค่าตามผู้จ่าย — เพิ่มผู้จ่ายอื่นได้ที่นี่ */
export const SAP_PAYERS: Record<string, SapPayerConfig> = {
  '50257': {
    payerId: '50257',
    account09: '0030001515',
    account40: '0043002200',
    col09Flag: 'C',
    companyCode: '1000',
    profitCenter: '2001',
    col40Ref: '30RC00000',
    docType: 'ZD',
    currency: 'THB',
    tagA: 'IPD',
    tagB: 'GGO',
  },
}

export interface SapCase {
  encounterId: number
  /** HN แบบไม่มีคำนำหน้า เช่น C2722091 */
  hn: string
  /** วันที่จำหน่าย YYYY-MM-DD */
  dischargeDate: string
  /** เลข Ref (claim_no) */
  claimNo: string
  /** ยอดรับเอกสาร (HIS) */
  hisAmount: number
  /** ยอดที่จ่ายตาม REP */
  paid: number
  /** วันที่ตอบกลับ YYYY-MM-DD */
  replyDate: string
}

export interface SapAmounts {
  /** บรรทัด 09 */
  a09: number
  /** บรรทัด 40 (0 = ไม่สร้างบรรทัด) */
  a40: number
  /** บรรทัด 11 */
  a11: number
  kind: 'short' | 'equal' | 'over'
}

const COLS = 47

/**
 * HN ให้ครบ 8 หลัก: ตัวอักษรนำหน้า + ตัวเลขเติมศูนย์ด้านหน้าให้รวมเป็น 8 ตัว (C289507 → C0289507)
 * ใช้กับทั้งคอลัมน์ HN (บรรทัด 11) และ HN เต็ม ("HN" + HN) — HN ที่ยาว 8 ตัวอยู่แล้วไม่เปลี่ยน
 */
export function padHn(hn: string, len = 8): string {
  const m = hn.trim().match(/^([A-Za-z]*)(\d+)$/)
  if (!m) return hn.trim()
  return m[1] + m[2].padStart(Math.max(len - m[1].length, m[2].length), '0')
}
const toSatang = (n: number) => Math.round(n * 100)
const fromSatang = (s: number) => s / 100

export function computeAmounts(hisAmount: number, paid: number): SapAmounts {
  const his = toSatang(hisAmount)
  const p = toSatang(paid)
  if (p < his) return { a09: fromSatang(p), a40: fromSatang(his - p), a11: fromSatang(his), kind: 'short' }
  if (p === his) return { a09: fromSatang(p), a40: 0, a11: fromSatang(his), kind: 'equal' }
  return { a09: fromSatang(his), a40: 0, a11: fromSatang(his), kind: 'over' }
}

/** YYYY-MM-DD → DDMMYYYY (ค.ศ.) */
export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}${m}${y}`
}

/** ตัวเลขแบบในไฟล์ตัวอย่าง: ไม่มีคอมมา ไม่มีศูนย์ท้าย (52330.5, 63758) */
export function fmtAmount(n: number): string {
  return String(Number(n.toFixed(2)))
}

function row(cells: Record<number, string>): string[] {
  const r = new Array<string>(COLS).fill('')
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v
  return r
}

export function buildCaseRows(c: SapCase, cfg: SapPayerConfig): string[][] {
  const amt = computeAmounts(c.hisAmount, c.paid)
  const hn = padHn(c.hn)
  const hnFull = `HN${hn}`
  const enc = String(c.encounterId)
  const reply = ddmmyyyy(c.replyDate)
  const rows: string[][] = []

  rows.push(
    row({
      0: 'H',
      1: ddmmyyyy(c.dischargeDate),
      2: cfg.docType,
      3: cfg.companyCode,
      4: reply,
      6: cfg.currency,
      8: c.claimNo,
    }),
  )

  rows.push(
    row({
      0: 'L',
      1: '09',
      2: cfg.account09,
      3: cfg.col09Flag,
      4: fmtAmount(amt.a09),
      6: cfg.companyCode,
      7: cfg.profitCenter,
      23: reply,
      29: hnFull,
      30: enc,
      32: cfg.tagA,
      33: cfg.tagB,
      44: cfg.payerId,
    }),
  )

  if (amt.a40 > 0) {
    rows.push(
      row({
        0: 'L',
        1: '40',
        2: cfg.account40,
        4: fmtAmount(amt.a40),
        6: cfg.companyCode,
        7: cfg.profitCenter,
        8: cfg.col40Ref,
        17: cfg.tagA,
        18: cfg.tagB,
        29: hnFull,
        30: enc,
        32: cfg.tagA,
        33: cfg.tagB,
      }),
    )
  }

  rows.push(
    row({
      0: 'L',
      1: '11',
      2: hn,
      4: fmtAmount(amt.a11),
      6: cfg.companyCode,
      7: cfg.profitCenter,
      23: reply,
      29: hnFull,
      30: enc,
      32: cfg.tagA,
      33: cfg.tagB,
      34: enc,
      44: hn,
      46: fmtAmount(amt.a11),
    }),
  )

  return rows
}

/** รวมทุกเคสเป็นข้อความ txt (tab ระหว่างคอลัมน์, CRLF ท้ายทุกบรรทัด) */
export function buildSapText(cases: SapCase[], cfg: SapPayerConfig): string {
  return cases
    .flatMap((c) => buildCaseRows(c, cfg))
    .map((r) => r.join('\t') + '\r\n')
    .join('')
}

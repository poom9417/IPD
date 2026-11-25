/**
 * สร้างไฟล์ txt (tab-delimited) สำหรับนำเข้า SAP เพื่อตั้งหนี้จากผลตอบกลับ REP
 * รูปแบบอ้างอิงจากไฟล์ตัวอย่างที่ใช้จริง (47 คอลัมน์, ขึ้นบรรทัดใหม่แบบ CRLF)
 *
 * 1 เคส = H + L09 + (L40 หรือ L50 อย่างใดอย่างหนึ่ง) + L11 — กรณีไม่มีส่วนต่างจะไม่มีทั้ง 40 และ 50
 *   H   หัวเอกสาร   : วันที่จำหน่าย, วันที่ตอบกลับ, เลข Ref (claim_no)
 *   L09 ยอดที่จ่าย  : บัญชี ACCOUNT_09 (Dr.)
 *   L40 ส่วนต่าง Dr.: บัญชี ACCOUNT_40 = ยอดตั้งเบิก − ยอดที่จ่าย (เมื่อจ่ายน้อยกว่า)
 *   L50 ส่วนต่าง Cr.: บัญชี/ฟิลด์เดียวกับ 40 แต่ขา 50 = ยอดที่จ่าย − ยอดตั้งเบิก (เมื่อจ่ายมากกว่า) (เพิ่ม 2026-11-25)
 *   L11 ลูกหนี้     : C+HN = ยอดที่เจนตั้งเบิก (ยอดส่งเบิก; เดิมใช้ยอด HIS — เปลี่ยน 2026-11-20) — HN = ตัวอักษร + ตัวเลข 8 หลัก (เติมศูนย์หน้า)
 *   L09 คอลัมน์ D   : 'C' (เดิม 'E')
 *
 * กติกายอด (ยืนยันกับผู้ใช้ 2026-11-11):
 *   จ่าย < ตั้งเบิก → 09 = จ่าย,     40 = ตั้งเบิก − จ่าย, 11 = ตั้งเบิก
 *   จ่าย = ตั้งเบิก → 09 = จ่าย,     ไม่มี 40,            11 = ตั้งเบิก
 *   จ่าย > ตั้งเบิก → 09 = จ่าย,     50 = จ่าย − ตั้งเบิก, 11 = ตั้งเบิก   (Dr. 09 = Cr. 50 + Cr. 11)
 * 40 กับ 50 เกิดพร้อมกันไม่ได้ (คนละขา Dr./Cr.)
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

/**
 * เลือก config ตามผู้จ่าย + สิทธิ (50087 ใช้ร่วมกันระหว่าง LGO กับ ONHSI* จึงต้องดู coverage)
 *   GGO 50257 · 0030001515 · C · GGO        GGO 50258 (กทม.) · 0030001516 · E · GGO
 *   LGO 50087 · 0030001344 · E · LGO        ONHSI* 50087 · 0030001344 · E · ONHSI
 *   ONHSI* 15251 · 0030001344 · N · ONHSI
 * ไม่รู้จัก → null (หน้าจอแจ้งว่ายังไม่รองรับ)
 */
export function resolveSapConfig(payerId: string | null | undefined, coverageCode: string | null | undefined): SapPayerConfig | null {
  const cov = (coverageCode ?? '').toUpperCase()
  const base = SAP_PAYERS['50257']
  switch (payerId) {
    case '50257':
      return base
    case '50258':
      return { ...base, payerId: '50258', account09: '0030001516', col09Flag: 'E', tagB: 'GGO' }
    case '50087':
      if (cov.startsWith('LGO')) return { ...base, payerId: '50087', account09: '0030001344', col09Flag: 'E', tagB: 'LGO' }
      if (cov.startsWith('ONHSI')) return { ...base, payerId: '50087', account09: '0030001344', col09Flag: 'E', tagB: 'ONHSI' }
      return null
    case '15251':
      if (cov.startsWith('ONHSI')) return { ...base, payerId: '15251', account09: '0030001344', col09Flag: 'N', tagB: 'ONHSI' }
      return null
    default:
      return null
  }
}

/** วันนี้ (เวลาไทย) เป็นวันศุกร์หรือไม่ */
export function isFridayInBangkok(now: Date = new Date()): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(now) === 'Fri'
}

/**
 * กติกา: การตั้งหนี้ (เอาเข้า SAP) ของผู้จ่ายกลุ่มนี้ต้องทำวันศุกร์เท่านั้น
 * สปสช. / LGO (50087, 15251) และ กทม. (50258) — ไม่รวม GGO กรมบัญชีกลาง 50257
 * ไม่มีการเปลี่ยนวันที่ในไฟล์ — ใช้เตือนตอนกดดาวน์โหลดเท่านั้น
 */
export const FRIDAY_ONLY_PAYERS: ReadonlySet<string> = new Set(['50087', '15251', '50258'])

export function isFridayOnlyPayer(payerId: string | null | undefined): boolean {
  return !!payerId && FRIDAY_ONLY_PAYERS.has(payerId)
}

/** วันนี้เป็นวันศุกร์หรือไม่ (เวลาท้องถิ่นของเครื่องผู้ใช้) */
export function isFriday(d: Date = new Date()): boolean {
  return d.getDay() === 5
}

export interface SapCase {
  encounterId: number
  /** HN แบบไม่มีคำนำหน้า เช่น C2722091 */
  hn: string
  /** วันที่จำหน่าย YYYY-MM-DD */
  dischargeDate: string
  /** เลข Ref (claim_no) */
  claimNo: string
  /** ยอดที่เจนตั้งเบิก (ยอดส่งเบิก) */
  claimAmount: number
  /** ยอดที่จ่ายตาม REP */
  paid: number
  /** วันที่ตอบกลับ YYYY-MM-DD */
  replyDate: string
}

export interface SapAmounts {
  /** บรรทัด 09 */
  a09: number
  /** บรรทัด 40 — ส่วนต่าง Dr. (0 = ไม่สร้างบรรทัด) */
  a40: number
  /** บรรทัด 50 — ส่วนต่าง Cr. (0 = ไม่สร้างบรรทัด) */
  a50: number
  /** บรรทัด 11 */
  a11: number
  kind: 'short' | 'equal' | 'over'
}

const COLS = 47

/**
 * HN ให้ครบ "ตัวเลข 8 หลัก" ต่อจากตัวอักษรนำหน้า: เติมศูนย์หน้าตัวเลขให้ได้ 8 หลัก (C289507 → C00289507)
 * ใช้กับทั้งคอลัมน์ HN (บรรทัด 11) และ HN เต็ม ("HN" + HN) — ตัวเลขที่ยาว 8 หลักขึ้นไปอยู่แล้วไม่เปลี่ยน
 */
export function padHn(hn: string, digits = 8): string {
  const m = hn.trim().match(/^([A-Za-z]*)(\d+)$/)
  if (!m) return hn.trim()
  return m[1] + m[2].padStart(digits, '0')
}
const toSatang = (n: number) => Math.round(n * 100)
const fromSatang = (s: number) => s / 100

export function computeAmounts(claimAmount: number, paid: number): SapAmounts {
  const his = toSatang(claimAmount)
  const p = toSatang(paid)
  if (p < his) return { a09: fromSatang(p), a40: fromSatang(his - p), a50: 0, a11: fromSatang(his), kind: 'short' }
  if (p === his) return { a09: fromSatang(p), a40: 0, a50: 0, a11: fromSatang(his), kind: 'equal' }
  return { a09: fromSatang(p), a40: 0, a50: fromSatang(p - his), a11: fromSatang(his), kind: 'over' }
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
  const amt = computeAmounts(c.claimAmount, c.paid)
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

  // ส่วนต่าง: จ่ายน้อยกว่า → ขา 40 (Dr.) / จ่ายมากกว่า → ขา 50 (Cr.) — ฟิลด์อื่นเหมือนกันทุกช่อง
  const diffLine = amt.a40 > 0 ? { key: '40', amount: amt.a40 } : amt.a50 > 0 ? { key: '50', amount: amt.a50 } : null
  if (diffLine) {
    rows.push(
      row({
        0: 'L',
        1: diffLine.key,
        2: cfg.account40,
        4: fmtAmount(diffLine.amount),
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

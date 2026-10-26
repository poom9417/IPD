import { supabase } from './supabaseClient'

// ============================================================================
// สรุปลูกหนี้ IPD ค้างส่งเบิก รวมทุกสิทธิ (โหมด Dashboard ในหน้าหลัก)
//
// นิยาม (ณ วันที่เลือก "asOf")
//   ค้างส่งเบิก      = เคสที่จำหน่ายแล้ว (discharge_date <= asOf) และยังไม่มีวันที่ส่งเบิก หรือส่งเบิกหลัง asOf
//   อายุ (วัน)       = asOf − discharge_date  (นับเป็นวันตามปฏิทิน ตัดเวลาออก)
//   จำนวนเงิน        = ยอดที่รับเอกสาร (document_received_amount = "ยอด claim จาก HIS") — เคสที่ยังไม่มียอดนับเป็น 0
//   ช่วงเกินกำหนด    = ภายใน 20 วัน | 21–30 | 31–90 | เกิน 90
//   รวมเกินกำหนด     = 21–30 + 31–90 + เกิน 90 (ไม่รวม "ภายใน 20 วัน" ซึ่งยังไม่เกิน)
//   % คงค้าง         = รวมเกินกำหนด ÷ ค้างส่งเบิก (แสดงทั้งตามจำนวนราย และตามจำนวนเงิน)
// ============================================================================

// ---------- การจัดกลุ่มสิทธิ (แก้ที่นี่ที่เดียว) ----------
// match(coverage_code, payer_id) ต้องไม่ซ้อนกันระหว่างกลุ่ม — 1 เคสอยู่ได้กลุ่มเดียว
const inFamily = (cov: string, base: string) => cov === base || cov.startsWith(base + '_')

export interface GroupDef {
  key: string
  label: string
  match: (coverageCode: string, payerId: string) => boolean
  /** true = กลุ่มรับส่วนที่เหลือ: เคสที่ไม่เข้ากลุ่มอื่นเลย (ยกเว้นสิทธิที่ไม่นับ เช่น UNK) จะมาอยู่กลุ่มนี้ */
  fallback?: boolean
}

export const SUMMARY_GROUPS: GroupDef[] = [
  {
    key: 'onhsi',
    label: 'ประกันสุขภาพนอกเขต (สปสช.)',
    match: (c) => inFamily(c, 'ONHSI'),
  },
  {
    // ข้าราชการเบิกจ่ายตรง = GGO ที่ผู้จ่ายไม่ใช่ กทม. (50257 กรมบัญชีกลาง + ผู้จ่ายอื่นของ GGO เช่น พัทยา, กสทช.)
    key: 'ggo',
    label: 'ข้าราชการเบิกจ่ายตรง (กบก.)',
    match: (c, p) => c === 'GGO' && p !== '50258',
  },
  {
    // ISSI ทุกรหัสย่อย ยกเว้นที่จ่ายผ่านรามาธิบดี 13781 (ไปอยู่กลุ่มท้ายตาราง)
    key: 'issi',
    label: 'ประกันสังคม ในเขต (ISSI)',
    match: (c, p) => inFamily(c, 'ISSI') && p !== '13781',
  },
  {
    key: 'ossi',
    label: 'ประกันสังคม นอกเขต (OSSI)',
    match: (c) => inFamily(c, 'OSSI'),
  },
  {
    key: 'lgo',
    label: 'ข้าราชการองค์กรปกครองส่วนท้องถิ่น (อปท.)',
    match: (c) => c === 'LGO',
  },
  {
    // ข้าราชการ กทม. = GGO ที่ผู้จ่ายเป็น 50258 กรุงเทพมหานคร
    key: 'bma',
    label: 'ข้าราชการกรุงเทพมหานคร (กทม.)',
    match: (c, p) => c === 'GGO' && p === '50258',
  },
  {
    key: 'sep',
    label: 'รัฐวิสาหกิจ (SEP)',
    match: (c) => inFamily(c, 'SEP'),
  },
  {
    key: 'pub',
    label: 'รัฐวิสาหกิจ (PUB)',
    match: (c) => inFamily(c, 'PUB'),
  },
  {
    // ไม่มีรหัสสิทธิ/ผู้จ่ายที่ชื่อ PRI ในข้อมูล — ตกลงให้รวมทุกสิทธิที่ไม่เข้ากลุ่มอื่นไว้ที่นี่
    // (ปัจจุบันคือ AR003 / AR003_Ya, AR006, EMU4 ฯลฯ และรหัสใหม่ที่ยังไม่ได้จัดกลุ่มในอนาคต — DIS_* ไม่นับ ดู isDiscountCoverage)
    key: 'pri',
    label: 'ต้นสังกัด PRI',
    match: () => false,
    fallback: true,
  },
  {
    key: 'smu',
    label: 'นักศึกษา (SMU)',
    match: (c) => c === 'SMU',
  },
  {
    key: 'aol',
    label: 'พรบ. AOL',
    match: (c) => c === 'AOL',
  },
  {
    key: 'bot',
    label: 'แบงค์ชาติ BOT',
    match: (c) => inFamily(c, 'BOT'),
  },
  {
    key: 'scg',
    label: 'รัฐวิสาหกิจ (SCG)',
    match: (c) => inFamily(c, 'SCG'),
  },
  {
    // ISSI ทุกรหัสย่อยที่ผู้จ่ายคือ โรงพยาบาลรามาธิบดี 13781 (ISSI / ISSI_2 / ISSI_3)
    key: 'rama',
    label: 'ประกันสังคม รามาธิบดี 13781 (PUB)',
    match: (c, p) => inFamily(c, 'ISSI') && p === '13781',
  },
]

/** รหัสสิทธิที่ไม่นับเป็นลูกหนี้เลย: UNK = เงินสด/ไม่ทราบสิทธิ (ไม่เบิก) */
const EXCLUDED_COVERAGES = new Set(['UNK'])

/** สิทธิส่วนลด/ส่วนเกิน (DIS_...) ไม่ใช่ลูกหนี้ที่ต้องส่งเบิก → ไม่นำมาคำนวณ (สอดคล้องกับ push-to-sheet ที่ไม่ส่ง DIS% ให้ Audit) */
const isDiscountCoverage = (cov: string) => cov.startsWith('DIS_')

// ---------- ช่วงอายุเกินกำหนด ----------
export interface BucketDef {
  key: string
  label: string
  /** อายุ (วัน) ตั้งแต่ - ถึง */
  min: number
  max: number
  /** true = ยังไม่เกินกำหนด (แสดงแต่ไม่นำไปรวมใน "รวมเกินกำหนด") */
  withinTerm?: boolean
}

export const BUCKETS: BucketDef[] = [
  { key: 'b20', label: 'ภายใน 20 วัน', min: -Infinity, max: 20, withinTerm: true },
  { key: 'b30', label: '21 - 30 วัน', min: 21, max: 30 },
  { key: 'b90', label: '31 - 90 วัน', min: 31, max: 90 },
  { key: 'b91', label: 'เกิน 90 วัน', min: 91, max: Infinity },
]

// ---------- ดึงข้อมูล (เฉพาะคอลัมน์ที่ใช้) ----------
export interface SummaryRow {
  coverage_code: string
  payer_id: string
  discharge_date: string | null
  submission_date: string | null
  amount: number | null
}

// ดึงทีเดียวแล้วคำนวณในเครื่อง → เปลี่ยนวันที่ "ณ" ได้ทันทีโดยไม่ต้องโหลดใหม่
// ใช้ฟังก์ชัน ar_summary_rows() ที่ DB คำสั่งเดียว (เดิมยิงหลาย request ขนาน + offset ลึก → เกิน statement_timeout)
// แต่ละแถว = [coverage_code, payer_id, discharge_date, submission_date, document_received_amount]
type RawRow = [string, string, string | null, string | null, number | string | null]

export async function fetchSummaryRows(): Promise<SummaryRow[]> {
  const { data, error } = await supabase.rpc('ar_summary_rows')
  if (error) throw error
  return ((data ?? []) as unknown as RawRow[]).map(([coverage_code, payer_id, discharge_date, submission_date, amt]) => ({
    coverage_code,
    payer_id,
    discharge_date,
    submission_date,
    amount: amt === null || amt === undefined ? null : Number(amt),
  }))
}

// ---------- คำนวณ ----------
export interface Cell {
  n: number
  amt: number
}

export interface GroupSummary {
  def: GroupDef
  pending: Cell
  buckets: Cell[] // ตามลำดับ BUCKETS
  overdue: Cell // รวมเกินกำหนด (ไม่รวม withinTerm)
  /** สัดส่วนคงค้าง (0–1) — null เมื่อไม่มีค้างส่งเบิก */
  pctN: number | null
  pctAmt: number | null
}

export interface SummaryResult {
  groups: GroupSummary[]
  total: GroupSummary
  /** เคสค้างที่ยังไม่มียอด (นับเป็น 0 บาท) */
  noAmountCount: number
  /** เคสค้างของสิทธิ UNK ที่ไม่นับ */
  excludedCount: number
  /** เคสค้างของสิทธิส่วนลด DIS_* ที่ไม่นับ */
  excludedDisCount: number
  /** เคสค้างที่ไม่อยู่ในกลุ่มใดเลย (ไม่รวมในผลรวม) — ปกติว่าง เพราะ PRI รับส่วนที่เหลือทั้งหมด */
  ungrouped: { coverage_code: string; n: number; amt: number }[]
  /** ใช้ตรวจ: จำนวนเคสที่จำหน่ายแล้ว ณ วันนั้นทั้งหมด (รวมที่ส่งเบิกแล้ว) */
  dischargedCount: number
}

// วันตามปฏิทิน (ตัดเวลา กัน timezone เลื่อน)
function dayNum(ymd: string | null): number | null {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null
}

const emptyCell = (): Cell => ({ n: 0, amt: 0 })

function emptyGroup(def: GroupDef): GroupSummary {
  return { def, pending: emptyCell(), buckets: BUCKETS.map(emptyCell), overdue: emptyCell(), pctN: null, pctAmt: null }
}

function finalize(g: GroupSummary) {
  g.overdue = emptyCell()
  BUCKETS.forEach((b, i) => {
    if (b.withinTerm) return
    g.overdue.n += g.buckets[i].n
    g.overdue.amt += g.buckets[i].amt
  })
  g.pctN = g.pending.n > 0 ? g.overdue.n / g.pending.n : null
  g.pctAmt = g.pending.amt > 0 ? g.overdue.amt / g.pending.amt : null
}

// ผลการจัดแถวเดียว ณ วันที่เลือก — ใช้ร่วมกันระหว่างตารางสรุป (buildSummary) กับไฟล์ Export รายการค้าง
// เพื่อให้ "รายการที่ถูกนับ" ตรงกับตัวเลขในตารางทุกแถว
export type RowClass =
  | { kind: 'future' } // ยังไม่จำหน่าย ณ วันนั้น
  | { kind: 'submitted' } // ส่งเบิกแล้ว ณ วันนั้น
  | { kind: 'unk' } // สิทธิ UNK ไม่นับ
  | { kind: 'dis' } // สิทธิส่วนลด DIS_* ไม่นับ
  | { kind: 'ungrouped'; amt: number }
  | { kind: 'counted'; def: GroupDef; age: number; amt: number; noAmount: boolean }

export function classifyRow(r: SummaryRow, asOfDay: number): RowClass {
  const dc = dayNum(r.discharge_date)
  if (dc === null || dc > asOfDay) return { kind: 'future' }
  const sub = dayNum(r.submission_date)
  if (sub !== null && sub <= asOfDay) return { kind: 'submitted' }
  // ----- เคสนี้ค้างส่งเบิก ณ asOf -----
  if (EXCLUDED_COVERAGES.has(r.coverage_code)) return { kind: 'unk' }
  if (isDiscountCoverage(r.coverage_code)) return { kind: 'dis' }
  const amt = r.amount ?? 0
  const def =
    SUMMARY_GROUPS.find((x) => !x.fallback && x.match(r.coverage_code, r.payer_id)) ??
    SUMMARY_GROUPS.find((x) => x.fallback)
  if (!def) return { kind: 'ungrouped', amt }
  return { kind: 'counted', def, age: asOfDay - dc, amt, noAmount: r.amount === null }
}

export function buildSummary(rows: SummaryRow[], asOf: string): SummaryResult {
  const asOfDay = dayNum(asOf)
  const groups = SUMMARY_GROUPS.map(emptyGroup)
  const total = emptyGroup({ key: 'total', label: 'รวม', match: () => false })
  const ungroupedMap = new Map<string, { n: number; amt: number }>()
  let noAmountCount = 0
  let excludedCount = 0
  let excludedDisCount = 0
  let dischargedCount = 0

  if (asOfDay === null) return { groups, total, noAmountCount, excludedCount, excludedDisCount, ungrouped: [], dischargedCount }

  for (const r of rows) {
    const c = classifyRow(r, asOfDay)
    if (c.kind === 'future') continue
    dischargedCount++ // จำหน่ายแล้ว ณ วันนั้น (รวมที่ส่งเบิกแล้ว)
    if (c.kind === 'submitted') continue
    if (c.kind === 'unk') {
      excludedCount++
      continue
    }
    if (c.kind === 'dis') {
      excludedDisCount++
      continue
    }
    if (c.kind === 'ungrouped') {
      const u = ungroupedMap.get(r.coverage_code) ?? { n: 0, amt: 0 }
      u.n++
      u.amt += c.amt
      ungroupedMap.set(r.coverage_code, u)
      continue
    }
    if (c.noAmount) noAmountCount++

    const g = groups.find((x) => x.def.key === c.def.key)!
    const bi = BUCKETS.findIndex((b) => c.age >= b.min && c.age <= b.max)
    for (const target of [g, total]) {
      target.pending.n++
      target.pending.amt += c.amt
      if (bi >= 0) {
        target.buckets[bi].n++
        target.buckets[bi].amt += c.amt
      }
    }
  }

  groups.forEach(finalize)
  finalize(total)

  return {
    groups,
    total,
    noAmountCount,
    excludedCount,
    excludedDisCount,
    ungrouped: [...ungroupedMap.entries()]
      .map(([coverage_code, v]) => ({ coverage_code, ...v }))
      .sort((a, b) => b.n - a.n),
    dischargedCount,
  }
}

/** วันที่วันนี้ตามเวลาท้องถิ่น (YYYY-MM-DD) */
export function todayYmd(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

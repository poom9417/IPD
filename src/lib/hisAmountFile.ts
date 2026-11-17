import * as XLSX from 'xlsx'

/**
 * อ่านไฟล์ยอดเงินจาก HIS (เช่น FINipd_4.xlsx) เพื่อนำเข้าเป็น "ยอดเงินจาก HIS" แทน user ปกติ
 *
 * คอลัมน์ที่ใช้: encid, hn, coverageCode, payerCode, discount, claimAmt
 *   ยอดที่บันทึก = claimAmt + discount
 *   payerCode ว่าง = UNK (ทำที่ฝั่ง DB)
 * คอลัมน์อื่น (an, ptName, Amount, cashOnly, absorb, ...) ใช้แสดงเทียบใน preview เท่านั้น
 */
export interface HisAmountRow {
  /** เลขแถวใน Excel (หัวตารางคือแถว 1) */
  line: number
  encounterId: number
  hn: string
  coverageCode: string
  payerId: string
  discount: number | null
  claimAmt: number | null
  /** claimAmt + discount (ปัดทศนิยม 2 ตำแหน่ง) หรือ null ถ้าอ่านตัวเลขไม่ได้ */
  amount: number | null
  name: string
}

const REQUIRED_HEADERS = ['encid', 'hn', 'coveragecode', 'payercode', 'discount', 'claimamt']

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return isFinite(n) ? n : null
}

export async function parseHisAmountFile(file: File): Promise<HisAmountRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('ไม่พบ sheet ในไฟล์')

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true })
  if (json.length === 0) throw new Error('ไฟล์ไม่มีข้อมูล')

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
    const discount = parseNum(r['discount'])
    const claimAmt = parseNum(r['claimamt'])
    return {
      line: i + 2,
      encounterId: Number(String(r['encid'] ?? '').trim()),
      hn: String(r['hn'] ?? '').trim(),
      coverageCode: String(r['coveragecode'] ?? '').trim(),
      payerId: String(r['payercode'] ?? '').trim(),
      discount,
      claimAmt,
      amount: discount === null || claimAmt === null ? null : Math.round((claimAmt + discount) * 100) / 100,
      name: String(r['ptname'] ?? '').trim(),
    }
  })
}

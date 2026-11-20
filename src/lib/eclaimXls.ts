/**
 * อ่านไฟล์ e-claim (.xls) ที่ export จากระบบ สปสช. — "รายงานการรักษาผู้ป่วยของหน่วยบริการ สำหรับ Invoice"
 * ใช้กับ 3 ชุด: IP (สปสช.), IPLGO (อปท./LGO), IPBKK (กทม.)
 * อ่านเฉพาะชีต "Detail" — หัวตารางอยู่คนละแถว/คนละคอลัมน์ในแต่ละชุด จึงหาคอลัมน์จากชื่อหัว ไม่ใช้เลขคอลัมน์ตายตัว
 */
import * as XLSX from 'xlsx'

export type EclaimKind = 'IP' | 'IPLGO' | 'IPBKK'

export interface EclaimItem {
  repNo: string
  seq: number
  tranId: string
  hn: string
  an: string
  name: string
  /** YYYY-MM-DD */
  admitDate: string
  /** YYYY-MM-DD */
  dischargeDate: string
  /** ชดเชยสุทธิ (ค่ารักษา) — ยอดที่ สปสช./ต้นสังกัดจ่ายจริงของแถวนี้ */
  paid: number
  /** Error Code ("-" = ไม่มี) */
  errorCode: string
  drg: string
  rw: number | null
  rightMain: string
  rightSub: string
  /** กองทุน (คอลัมน์ "กองทุน" / "กองทุนหลัก") */
  fund: string
}

export interface EclaimFile {
  kind: EclaimKind
  /** จากชื่อไฟล์ eclaim_41373_IPLGO_25691106_... → 41373 */
  hospCode: string
  /** เลขที่เอกสาร (invoice) = ชื่อไฟล์ไม่รวมนามสกุล */
  invoiceNo: string
  /** REP No. ที่พบในแถวข้อมูล (ปกติมีค่าเดียว) */
  repNo: string
  items: EclaimItem[]
  /** รวมยอดชดเชยสุทธิทุกแถว */
  totalPaid: number
  /** แถวที่อ่านไม่ได้ (วันที่/ยอดผิดรูปแบบ) พร้อมเหตุผล */
  unreadable: string[]
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

function toNum(v: unknown): number | null {
  const s = norm(v).replace(/,/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "14/10/2026 12:33:00" → "2026-10-14" (ปีในข้อมูลเป็น ค.ศ.; ถ้าเจอ พ.ศ. (>2400) แปลงให้) */
export function parseEclaimDate(v: unknown): string | null {
  const m = norm(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  let y = Number(m[3])
  if (y > 2400) y -= 543
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export function kindFromFileName(name: string): EclaimKind | null {
  const m = name.match(/eclaim_\d+_([A-Z]+)_/i)
  const k = m?.[1]?.toUpperCase()
  return k === 'IP' || k === 'IPLGO' || k === 'IPBKK' ? k : null
}

export function parseEclaimXls(buf: ArrayBuffer, fileName: string): EclaimFile {
  const kind = kindFromFileName(fileName)
  if (!kind) throw new Error('ชื่อไฟล์ไม่ใช่รูปแบบ e-claim (eclaim_รหัสรพ._IP / IPLGO / IPBKK_…xls)')
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets['Detail']
  if (!ws) throw new Error('ไม่พบชีต "Detail" ในไฟล์')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false })

  // แถวหัวตาราง = แถวที่ช่องแรกเป็น REP / REP No.
  const headIdx = rows.findIndex((r) => /^REP( No\.?)?$/i.test(norm(r[0])))
  if (headIdx < 0) throw new Error('ไม่พบแถวหัวตาราง (REP) ในชีต Detail')
  const head = rows[headIdx].map(norm)
  const col = (pred: (h: string) => boolean, label: string) => {
    const i = head.findIndex(pred)
    if (i < 0) throw new Error(`ไม่พบคอลัมน์ ${label} ในไฟล์`)
    return i
  }
  const cTran = col((h) => h === 'TRAN_ID', 'TRAN_ID')
  const cHn = col((h) => h === 'HN', 'HN')
  const cAn = col((h) => h === 'AN', 'AN')
  const cName = col((h) => h.replace(/ /g, '').startsWith('ชื่อ-สกุล'), 'ชื่อ-สกุล')
  const cAdmit = col((h) => h === 'วันเข้ารักษา', 'วันเข้ารักษา')
  const cDisch = col((h) => h === 'วันจำหน่าย', 'วันจำหน่าย')
  const cPaid = col((h) => h === 'ชดเชยสุทธิ', 'ชดเชยสุทธิ')
  const cErr = col((h) => h === 'Error Code', 'Error Code')
  const cSeq = col((h) => h === 'ลำดับที่', 'ลำดับที่')
  const cDrg = head.findIndex((h) => h === 'DRG')
  const cRw = head.findIndex((h) => h === 'RW')
  const cRight = head.findIndex((h) => h === 'สิทธิหลัก')
  const cRightSub = head.findIndex((h) => h === 'สิทธิรอง' || h === 'สิทธิย่อย')
  const cFund = head.findIndex((h) => h === 'กองทุน' || h === 'กองทุนหลัก')

  const items: EclaimItem[] = []
  const unreadable: string[] = []
  for (let r = headIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    const repNo = norm(row[0])
    // แถวข้อมูล = ช่อง REP เป็นตัวเลขล้วน และมี TRAN_ID (แถวหัวย่อยและหมายเหตุท้ายตารางข้ามไป)
    if (!/^\d+$/.test(repNo) || !norm(row[cTran])) continue
    const admit = parseEclaimDate(row[cAdmit])
    const disch = parseEclaimDate(row[cDisch])
    const paid = toNum(row[cPaid])
    if (!admit || !disch || paid == null) {
      unreadable.push(`แถว ${r + 1} (TRAN_ID ${norm(row[cTran])}): ${!admit ? 'วันเข้ารักษา' : !disch ? 'วันจำหน่าย' : 'ชดเชยสุทธิ'} อ่านไม่ได้`)
      continue
    }
    items.push({
      repNo,
      seq: Number(norm(row[cSeq])) || items.length + 1,
      tranId: norm(row[cTran]),
      hn: norm(row[cHn]),
      an: norm(row[cAn]),
      name: norm(row[cName]),
      admitDate: admit,
      dischargeDate: disch,
      paid,
      errorCode: norm(row[cErr]) || '-',
      drg: cDrg >= 0 ? norm(row[cDrg]) : '',
      rw: cRw >= 0 ? toNum(row[cRw]) : null,
      rightMain: cRight >= 0 ? norm(row[cRight]) : '',
      rightSub: cRightSub >= 0 ? norm(row[cRightSub]) : '',
      fund: cFund >= 0 ? norm(row[cFund]) : '',
    })
  }

  const reps = [...new Set(items.map((i) => i.repNo))]
  const hosp = fileName.match(/eclaim_(\d+)_/i)?.[1] ?? ''
  const totalPaid = Math.round(items.reduce((s, i) => s + Math.round(i.paid * 100), 0)) / 100
  return {
    kind,
    hospCode: hosp,
    invoiceNo: fileName.replace(/\.xls$/i, ''),
    repNo: reps.length === 1 ? reps[0] : reps.join(','),
    items,
    totalPaid,
    unreadable,
  }
}

/**
 * อ่านไฟล์ตอบกลับผู้ป่วยใน สวัสดิการรักษาพยาบาลข้าราชการ (CIGNREP .REP จากระบบเบิกจ่ายตรง)
 *
 * หมายเหตุสำคัญ: เลขที่อยู่หลัง "*| 0 A" ในไฟล์ถูกเรียกว่า "AN" ในไฟล์ แต่ค่าจริงคือ encounter_id ของระบบเรา
 * ยอดที่จ่าย = ยอด DRG (ตัวเลขหลัง adjrw) + ยอดจ่ายนอก DRG (ตัวเลขใน "(=...)")
 */

export interface RepItem {
  /** ตอนที่ในไฟล์ (1 = กรมบัญชีกลาง, 3 = กสทช., 4 = กกต., 5 = เมืองพัทยา) */
  section: number
  pcode: string
  /** encounter_id */
  encounterId: number
  drgCode: string
  /** RW (ค่าในวงเล็บ) */
  rw: number
  adjRw: number
  /** ccuf — มีเฉพาะ DRG ยาเคมีบำบัดที่แสดง "adjrw X ccuf" */
  ccuf: number | null
  /** รหัสข้อผิดพลาด/เตือนท้ายบรรทัดตามไฟล์ */
  msgRaw: string
  /** ยอดเงินตาม DRG (บาท) */
  drgAmount: number
  /** ยอดจ่ายนอก DRG (บาท) */
  outDrgAmount: number
  /** ยอดที่จ่ายรวม = drgAmount + outDrgAmount (ปัดเป็นสตางค์) */
  paid: number
  name: string
}

/** รหัสผลการตรวจรับ 1 ตัวท้ายบรรทัด เช่น "662:L03650" (code = 662, detail = L03650) */
export interface RepCode {
  code: string
  /** ค่าอ้างอิงหลังเครื่องหมาย ":" — รหัสรายการที่ผิด (ค่าบริการ/Lab/ยา/หัตถการ) ใช้ตอนไปแก้ */
  detail: string | null
  kind: 'error' | 'warning' | 'info'
}

/**
 * แยกชนิดรหัสตามที่ผู้ใช้จริงใช้งาน: รหัสที่มาก่อน 837 (212, 350, 661, 662, 673 …) คือ error ที่ต้องแก้
 * 837 / 83A คือคำเตือน ไม่ต้องแก้ · 926 คือแจ้งเพื่อทราบ (ยอดยากลับบ้าน)
 * (ไฟล์เรียงรหัสจากน้อยไปมาก จึงตัดที่ 837 ได้ — ชนิดที่แท้จริงของแต่ละรหัสดูจาก master C ถ้ามี)
 */
export function classifyCode(code: string): RepCode['kind'] {
  if (/^\d{3}$/.test(code)) {
    if (Number(code) < 837) return 'error'
    if (code === '926') return 'info'
  }
  return 'warning'
}

/** แยกข้อความท้ายบรรทัด (msg) เป็นรายการรหัส + จำนวนรหัสที่ไฟล์ตัดไม่แสดง ("+ ... (16)") */
export function splitMsg(raw: string | null | undefined): { codes: RepCode[]; more: number } {
  const codes: RepCode[] = []
  let more = 0
  for (const tok of (raw ?? '').split(',')) {
    const t = tok.trim()
    if (!t) continue
    const m = t.match(/^\+\s*\.\.\.\s*\((\d+)\)$/)
    if (m) {
      more = Number(m[1])
      continue
    }
    const i = t.indexOf(':')
    const code = (i < 0 ? t : t.slice(0, i)).trim()
    const detail = i < 0 ? '' : t.slice(i + 1).trim()
    if (!code) continue
    codes.push({ code, detail: detail || null, kind: classifyCode(code) })
  }
  return { codes, more }
}

/** คำอธิบายรหัสจากตาราง "รหัสผลการตรวจรับ" ท้ายไฟล์ REP */
export interface RepLegendEntry {
  code: string
  description: string
  advice: string | null
}

export interface RepRejected {
  encounterId: number
  tcode: string
  name: string
  msgRaw: string
}

export interface RepFile {
  hospCode: string
  /** เลขที่เอกสารตอบรับ */
  repNo: string
  /** วันที่ออกเอกสาร YYYY-MM-DD (ค.ศ.) */
  issueDate: string
  /** จำนวนรายที่ผ่านตามหัวไฟล์ */
  headerCount: number | null
  /** จำนวนเงินรวมตามหัวไฟล์ */
  headerTotal: number | null
  /** รายการที่ตรวจผ่าน (tcode A) และอ่านรูปแบบ DRG ได้ */
  items: RepItem[]
  /** รายการที่ต้องแก้ไข/รอใบรับรอง (ไม่นำมาตั้งหนี้) */
  notPassed: RepRejected[]
  /** บรรทัดที่ตรวจผ่านแต่โปรแกรมยังอ่านไม่ได้ (เช่น รูปแบบ FFS/PD) — ต้องแจ้งเตือน ห้ามข้ามเงียบ ๆ */
  unreadable: string[]
  /** ตาราง "รหัสผลการตรวจรับ" ท้ายไฟล์ (รหัส + คำอธิบาย + คำแนะนำ) ใช้เติม master C */
  legend: RepLegendEntry[]
  /** ข้อความเต็มของไฟล์ REP — เก็บไว้ให้ผู้ใช้เปิดดูแบบเดียวกับที่เคยเปิดใน Notepad */
  rawText: string
}

const num = (s: string) => Number(s.replace(/,/g, ''))
const cents = (n: number) => Math.round(n * 100) / 100

/** แปลง "28/10/2569" (พ.ศ.) เป็น "2026-10-28" */
function thaiDateToIso(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  let y = Number(m[3])
  if (y > 2400) y -= 543
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** ไฟล์ .REP มักเป็น UTF-8 แต่ถ้าเป็น TIS-620 / cp874 ก็อ่านได้ */
export function decodeRep(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-874').decode(buf)
  }
}

// *| 0 A 3036015  , 01571, ( 1.3808)  2.1080, 25823.00, นาย ... (=26507.50): ...
// adjrw อาจเป็น "7.1002 X 0.8249" (มี ccuf) — ยอดเงินที่ตามมาคือยอดสุดท้ายแล้ว
const DRG_RE =
  /^\*\|\s*(\d)\s+A\s+(\d+)\s*,\s*([^,\s]+)\s*,\s*\(\s*([\d.]+)\)\s+([\d.]+)(?:\s*X\s*([\d.]+))?\s*,\s*([\d,]+(?:\.\d+)?)\s*,\s*(.+?)\(=\s*([\d,]+(?:\.\d+)?)\)(?:\s*:\s*(.*))?$/

export function parseRep(text: string): RepFile {
  const lines = text.split(/\r?\n/)
  const head = (label: RegExp) => {
    for (const l of lines.slice(0, 40)) {
      if (label.test(l)) return l.split('=').slice(1).join('=').trim()
    }
    return ''
  }

  const hospCode = head(/^รหัส\s*ร\.พ\./)
  const repNo = head(/^เลขที่เอกสารตอบรับ/)
  const issueDate = thaiDateToIso(head(/^วันที่ออกเอกสาร/)) ?? ''
  const countRaw = head(/^จำนวนราย/)
  const totalRaw = head(/^จำนวนเงินรวม/)
  const headerCount = countRaw ? num(countRaw) : null
  const headerTotal = totalRaw ? num(totalRaw.replace(/บาท/, '')) : null

  if (!repNo || !issueDate) throw new Error('ไม่ใช่ไฟล์ตอบรับ REP (ไม่พบเลขที่เอกสารตอบรับ/วันที่ออกเอกสาร)')

  const items: RepItem[] = []
  const notPassed: RepRejected[] = []
  const unreadable: string[] = []

  let section = 0 // 0 = ไม่อยู่ในตอนที่ของ CIPN
  let region: 'passed' | 'csmbs' | 'other' = 'other'

  for (const line of lines) {
    if (/^\*\*\*/.test(line)) {
      if (/รายการที่ตรวจผ่านแล้ว.*\(CIPN\)/.test(line)) region = 'passed'
      else if (/รายการที่ตรวจผ่านแล้ว.*\(CSMBS\)/.test(line)) region = 'csmbs'
      else region = 'other'
      section = 0
      continue
    }
    const sec = line.match(/^\*\*\s+ตอนที่\s+(\d+)/)
    if (sec) {
      section = Number(sec[1])
      continue
    }
    if (!line.startsWith('*|')) continue

    // รายการที่ไม่ผ่าน: "*| - C 3056076  , ชื่อ: ..." หรือรอใบรับรอง tcode T
    const head2 = line.match(/^\*\|\s*(\S+)\s+([A-Z])\s+(\d+)\s*,\s*(.*)$/)
    if (!head2) {
      unreadable.push(line)
      continue
    }
    const [, pcode, tcode, enc, rest] = head2
    if (tcode !== 'A') {
      const [nm, ...msg] = rest.split(':')
      notPassed.push({ encounterId: Number(enc), tcode, name: nm.trim(), msgRaw: msg.join(':').trim() })
      continue
    }
    if (region !== 'passed') {
      unreadable.push(line)
      continue
    }
    const m = line.match(DRG_RE)
    if (!m) {
      unreadable.push(line)
      continue
    }
    const drgAmount = cents(num(m[7]))
    const outDrgAmount = cents(num(m[9]))
    items.push({
      section,
      pcode,
      encounterId: Number(m[2]),
      drgCode: m[3],
      rw: Number(m[4]),
      adjRw: Number(m[5]),
      ccuf: m[6] ? Number(m[6]) : null,
      msgRaw: (m[10] ?? '').trim(),
      drgAmount,
      outDrgAmount,
      paid: cents(drgAmount + outDrgAmount),
      name: m[8].trim(),
    })
  }

  // ตารางรหัสท้ายไฟล์: "--662: คำอธิบาย" ตามด้วยบรรทัด "\t(คำแนะนำ:...)" (บางรหัสไม่มีคำแนะนำ)
  const legend: RepLegendEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const lm = lines[i].match(/^--(\w{3}):\s*(.*)$/)
    if (!lm) continue
    const adv = (lines[i + 1] ?? '').match(/^\s*\(คำแนะนำ:(.*)\)\s*$/)
    legend.push({ code: lm[1], description: lm[2].trim(), advice: adv ? adv[1].trim() : null })
  }

  return { hospCode, repNo, issueDate, headerCount, headerTotal, items, notPassed, unreadable, legend, rawText: text }
}

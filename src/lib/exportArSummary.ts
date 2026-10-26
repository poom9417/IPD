import { BUCKETS, SUMMARY_GROUPS, buildSummary, classifyRow, fetchSummaryRows, type GroupSummary, type SummaryRow } from './arSummary'
import { admissionRecord, HEADERS, loadExcelJS } from './exportExcel'
import { supabase } from './supabaseClient'
import type { Admission } from './types'

// Export ของโหมด Dashboard (สรุปค้างส่งเบิกรวมทุกสิทธิ) → ไฟล์ .xlsx 2 ชีต
//   1) "ตารางรวม"        = ตารางเดียวกับที่เห็นบนเว็บ ณ วันที่เลือก
//   2) "รายการที่ค้าง"   = เคสที่ถูกนำมานับในตารางนั้น (หัวคอลัมน์เหมือน Export หน้าหลัก + "กลุ่มสิทธิ" เป็นคอลัมน์แรก)
// ชีต 1 ใช้ ar_summary_rows (ชุดเดียวกับตารางบนเว็บ) ส่วนชีต 2 ใช้ ar_pending_admissions ที่ดึงเฉพาะเคสที่อาจค้าง ณ วันนั้น
// (ไม่ดึงทั้งตาราง → เร็วและไม่ชนเวลา query ของฐานข้อมูล) และจัดกลุ่มด้วย classifyRow ตัวเดียวกับตาราง

const GROUP_HEADER = 'กลุ่มสิทธิ'
const NUM_FMT_N = '#,##0;-#,##0;"–"'
const NUM_FMT_MONEY = '#,##0.00;-#,##0.00;"–"'
const PCT_FMT = '0.00%'

const asSummaryRow = (a: Admission): SummaryRow => {
  const amt = a.case_tracking?.document_received_amount
  return {
    coverage_code: a.coverage_code,
    payer_id: a.payer_id,
    discharge_date: a.discharge_date,
    submission_date: a.case_tracking?.submission_date ?? null,
    amount: amt === null || amt === undefined ? null : Number(amt),
  }
}

const thaiDate = (ymd: string) =>
  new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })

export async function exportArSummaryToExcel(asOf: string, opts: { role?: string | null } = {}): Promise<{ pending: number }> {
  // viewer ห้ามส่งออกข้อมูล (กันอีกชั้นนอกเหนือจากการซ่อนปุ่ม)
  if (opts.role === 'viewer') throw new Error('role ผู้ดูข้อมูล (viewer) ไม่มีสิทธิ์ Export')
  if (!asOf) throw new Error('เลือกวันที่ก่อน')

  const [summaryRows, pendingRes] = await Promise.all([
    fetchSummaryRows(),
    supabase.rpc('ar_pending_admissions', { p_asof: asOf }),
  ])
  if (pendingRes.error) throw pendingRes.error
  const admissions = (pendingRes.data ?? []) as unknown as Admission[]
  const rows = admissions.map(asSummaryRow)
  const summary = buildSummary(summaryRows, asOf)

  // รายการที่ถูกนับในตาราง (ใช้ classifyRow ตัวเดียวกับ buildSummary)
  const asOfDay = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10)) / 86_400_000
  const groupIndex = new Map(SUMMARY_GROUPS.map((g, i) => [g.key, i]))
  const counted: { a: Admission; label: string; order: number }[] = []
  admissions.forEach((a, i) => {
    const c = classifyRow(rows[i], asOfDay)
    if (c.kind === 'counted') counted.push({ a, label: c.def.label, order: groupIndex.get(c.def.key) ?? 0 })
  })
  // เรียงตามลำดับกลุ่มในตาราง แล้วจำหน่ายเก่า → ใหม่ (เก่าสุด = ค้างนานสุดอยู่บน)
  counted.sort(
    (x, y) =>
      x.order - y.order ||
      (x.a.discharge_date ?? '').localeCompare(y.a.discharge_date ?? '') ||
      x.a.admission_id - y.a.admission_id,
  )

  const { Workbook } = await loadExcelJS()
  const wb = new Workbook()

  // ================= ชีต 1: ตารางรวม =================
  const ws1 = wb.addWorksheet('ตารางรวม')
  const lastCol = 1 + 2 + BUCKETS.length * 2 + 2 + 2 // 15
  const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true }
  const thin = { style: 'thin' as const, color: { argb: 'FF999999' } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }

  // หัวตาราง 3 แถว (เหมือนบนเว็บ)
  const bucketStart = 4
  const overdueCol = bucketStart + BUCKETS.length * 2 // 12
  const pctCol = overdueCol + 2 // 14
  ws1.getCell(1, 1).value = 'สิทธิ'
  ws1.mergeCells(1, 1, 3, 1)
  ws1.getCell(1, 2).value = `IPD ค้างส่งเบิก\nณ ${thaiDate(asOf)}`
  ws1.mergeCells(1, 2, 2, 3)
  ws1.getCell(1, bucketStart).value = 'เกินกำหนดเรียกเก็บ IPD'
  ws1.mergeCells(1, bucketStart, 1, overdueCol - 1)
  BUCKETS.forEach((b, i) => {
    ws1.getCell(2, bucketStart + i * 2).value = b.label
    ws1.mergeCells(2, bucketStart + i * 2, 2, bucketStart + i * 2 + 1)
  })
  ws1.getCell(1, overdueCol).value = 'รวมเกินกำหนด\nไม่รวมภายใน 20 วัน'
  ws1.mergeCells(1, overdueCol, 2, overdueCol + 1)
  ws1.getCell(1, pctCol).value = 'เปอร์เซ็นคงค้าง\nรวมเกินกำหนด ÷ ค้างส่งเบิก'
  ws1.mergeCells(1, pctCol, 2, pctCol + 1)
  for (let c = 2; c < pctCol; c += 2) {
    ws1.getCell(3, c).value = 'ราย'
    ws1.getCell(3, c + 1).value = 'เงิน (บาท)'
  }
  ws1.getCell(3, pctCol).value = 'ตามราย'
  ws1.getCell(3, pctCol + 1).value = 'ตามเงิน'
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws1.getCell(r, c)
      cell.font = { bold: true }
      cell.alignment = center
      cell.border = border
    }
  }
  ws1.getRow(1).height = 34

  // เนื้อตาราง: ทุกกลุ่ม + แถวรวม
  const putGroup = (g: GroupSummary, bold: boolean) => {
    const cells = [g.pending, ...g.buckets, g.overdue]
    const values: (string | number)[] = [g.def.label]
    for (const c of cells) values.push(c.n, c.amt)
    values.push(g.pctN ?? '–', g.pctAmt ?? '–')
    const row = ws1.addRow(values)
    row.eachCell((cell, col) => {
      cell.border = border
      if (bold) cell.font = { bold: true }
      if (col === 1) return
      cell.alignment = { horizontal: 'right' }
      if (col >= pctCol) cell.numFmt = PCT_FMT
      else cell.numFmt = col % 2 === 0 ? NUM_FMT_N : NUM_FMT_MONEY
    })
  }
  summary.groups.forEach((g) => putGroup(g, false))
  putGroup(summary.total, true)

  // หมายเหตุใต้ตาราง (ข้อความเดียวกับหน้าเว็บ)
  ws1.addRow([])
  const note = (t: string) => ws1.addRow([t])
  note(
    'จำนวนเงิน = ยอดที่รับเอกสาร (ยอด claim จาก HIS) · ' +
      (summary.noAmountCount > 0
        ? `มี ${summary.noAmountCount.toLocaleString('th-TH')} รายที่ยังไม่มียอด (ยังไม่รับเอกสาร) จึงนับเป็น 0 บาท`
        : 'ทุกรายที่ค้างมียอดครบ'),
  )
  note('ต้นสังกัด PRI = ทุกสิทธิที่ไม่อยู่ในกลุ่มอื่น (เช่น AR003, AR006, EMU4) · ไม่นับสิทธิส่วนลด DIS_*')
  note(`ไม่นับสิทธิ UNK (เงินสด / ไม่เบิก) ที่ค้างอยู่ ${summary.excludedCount.toLocaleString('th-TH')} ราย`)
  note(`ไม่นับสิทธิส่วนลด DIS_* ที่ค้างอยู่ ${summary.excludedDisCount.toLocaleString('th-TH')} ราย`)
  if (summary.ungrouped.length > 0) {
    note(
      'ยังไม่ได้จัดเข้ากลุ่ม (ไม่รวมในผลรวม): ' +
        summary.ungrouped.map((u) => `${u.coverage_code} ${u.n} ราย`).join(' · '),
    )
  }
  note(`เคสที่จำหน่ายแล้ว ณ วันที่เลือกทั้งหมด ${summary.dischargedCount.toLocaleString('th-TH')} ราย (รวมที่ส่งเบิกแล้วและสิทธิที่ไม่นับ)`)

  ws1.getColumn(1).width = 46
  for (let c = 2; c <= lastCol; c++) ws1.getColumn(c).width = c % 2 === 0 && c < pctCol ? 9 : 16
  ws1.getColumn(pctCol).width = 12
  ws1.getColumn(pctCol + 1).width = 12
  ws1.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }]

  // ================= ชีต 2: รายการที่ค้าง =================
  const ws2 = wb.addWorksheet('รายการที่ค้าง')
  const headers = [GROUP_HEADER, ...HEADERS]
  const records = counted.map((x) => ({ [GROUP_HEADER]: x.label, ...admissionRecord(x.a) }) as Record<string, string | number | null>)
  ws2.addRow(headers)
  for (const r of records) ws2.addRow(headers.map((h) => r[h] ?? null))
  headers.forEach((h, i) => {
    const longest = records.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length)
    ws2.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 60)
  })
  if (records.length > 0) {
    ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: records.length + 1, column: headers.length } }
  }

  // ดาวน์โหลด (เหมือน Export หน้าหลัก)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ipd-ar-summary-${asOf}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { pending: counted.length }
}

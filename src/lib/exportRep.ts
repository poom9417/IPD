import { loadExcelJS } from './exportExcel'
import { RESULT_LABEL, type RepRow, type RepSummaryLine } from './repDashboard'

/** Export Excel ของ Dashboard ผลตอบกลับ REP — ตามตัวกรองบนหน้าจอ (2 ชีต: สรุปตามสิทธิ/เลข REP และรายการเคส) */
export async function exportRepDashboard(rows: RepRow[], summary: RepSummaryLine[]): Promise<void> {
  const { Workbook } = await loadExcelJS()
  const wb = new Workbook()

  const s = wb.addWorksheet('สรุปตามสิทธิและเลข REP')
  const sh = ['สิทธิ', 'ผู้จ่าย', 'เลข REP', 'วันที่ตอบกลับ', 'จำนวนเคส', 'ผ่าน', 'ติด C', 'อื่น ๆ']
  s.addRow(sh)
  for (const l of summary) s.addRow([l.coverageCode, l.payerId, l.repNo, l.replyDate, l.total, l.passed, l.c, l.other])
  sh.forEach((h, i) => (s.getColumn(i + 1).width = Math.max(h.length + 4, 14)))

  const d = wb.addWorksheet('ผลตอบกลับรายเคส')
  const dh = ['encounter_id', 'HN', 'ชื่อผู้ป่วย', 'วันที่จำหน่าย', 'สิทธิ', 'ผู้จ่าย', 'เลขตั้งเบิกปัจจุบัน', 'วันที่ส่งเบิก', 'REP ล่าสุด', 'วันที่ตอบกลับ', 'ยอดที่จ่าย (REP)', 'ยอดที่ตั้งเบิก', 'ส่วนต่าง', 'สถานะ', 'ส่งแก้แล้ว รอผล', 'จำนวนรอบที่ติด C']
  d.addRow(dh)
  for (const r of rows) {
    d.addRow([
      String(r.encounterId), r.hn, r.name, r.dischargeDate, r.coverageCode, r.payerId, r.currentClaimNo, r.submissionDate,
      r.repNo, r.replyDate, r.paidAmount, r.claimedAmount, r.diffAmount, RESULT_LABEL(r), r.resent ? 'ใช่' : '', r.cRounds || null,
    ])
  }
  dh.forEach((h, i) => (d.getColumn(i + 1).width = Math.max(h.length + 4, 14)))
  for (const c of [10, 11, 12]) d.getColumn(c).numFmt = '#,##0.00'
  if (rows.length > 0) d.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: dh.length } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rep-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

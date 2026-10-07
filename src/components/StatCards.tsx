import type { Admission } from '../lib/types'

export default function StatCards({ admissions }: { admissions: Admission[] }) {
  // 1 encounter อาจมีหลายแถว (แยกสิทธิ/ผู้จ่าย) — นับ 1 เคส = 1 encounter_id + 1 payer
  // (encounter เดียวกันแต่มี 2 payer นับเป็น 2 เคส)
  const encounters = Array.from(
    new Map(admissions.map((a) => [`${a.encounter_id}|${a.payer_id ?? ''}`, a])).values(),
  )
  const total = encounters.length
  const avgLos =
    total === 0
      ? 0
      : Math.round((encounters.reduce((sum, a) => sum + (a.los ?? 0), 0) / total) * 10) / 10
  const uniquePatients = new Set(admissions.map((a) => a.hn)).size

  // ยอดรับเอกสารเก็บรายแถว (case_tracking ผูกกับ admission แต่ละสิทธิ) — รวมทุกแถวที่กรองอยู่
  const received = admissions.filter((a) => a.case_tracking?.document_received_amount != null)
  const receivedTotal = received.reduce((sum, a) => sum + (a.case_tracking?.document_received_amount ?? 0), 0)

  const stats: { label: string; value: string; note?: string }[] = [
    { label: 'เคสทั้งหมด', value: total.toLocaleString() },
    { label: 'จำนวนผู้ป่วย', value: uniquePatients.toLocaleString() },
    { label: 'LOS เฉลี่ย (วัน)', value: avgLos.toLocaleString() },
    {
      label: 'ยอด claim จาก HIS รวม (บาท)',
      value: receivedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      note: `จาก ${received.length.toLocaleString()} รายการที่มียอด`,
    },
  ]

  return (
    <div data-tour="stat-cards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">{s.label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{s.value}</p>
          {s.note && <p className="mt-0.5 text-sm text-ink/70">{s.note}</p>}
        </div>
      ))}
    </div>
  )
}

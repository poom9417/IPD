import type { AdmissionStats } from '../lib/searchAdmissions'

// ตัวเลขสรุปคิดที่ DB จากทุกแถวที่ตรงตัวกรอง (ไม่ใช่แค่หน้าที่แสดง)
// 1 เคส = 1 encounter_id + 1 payer (encounter เดียวกันแต่มี 2 payer นับเป็น 2 เคส)
export default function StatCards({ stats }: { stats: AdmissionStats | null }) {
  const dash = '–'
  const list: { label: string; value: string; note?: string }[] = [
    { label: 'เคสทั้งหมด', value: stats ? stats.cases.toLocaleString() : dash },
    { label: 'จำนวนผู้ป่วย', value: stats ? stats.patients.toLocaleString() : dash },
    { label: 'LOS เฉลี่ย (วัน)', value: stats ? stats.avg_los.toLocaleString() : dash },
    {
      label: 'ยอด claim จาก HIS รวม (บาท)',
      value: stats
        ? stats.received_total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : dash,
      note: stats ? `จาก ${stats.received_count.toLocaleString()} รายการที่มียอด` : undefined,
    },
  ]

  return (
    <div data-tour="stat-cards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {list.map((s) => (
        <div key={s.label} className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">{s.label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{s.value}</p>
          {s.note && <p className="mt-0.5 text-sm text-ink/70">{s.note}</p>}
        </div>
      ))}
    </div>
  )
}

import type { Admission } from '../lib/types'

export default function StatCards({ admissions }: { admissions: Admission[] }) {
  const total = admissions.length
  const active = admissions.filter((a) => !a.discharge_date).length
  const avgLos =
    total === 0
      ? 0
      : Math.round((admissions.reduce((sum, a) => sum + (a.los ?? 0), 0) / total) * 10) / 10
  const uniquePatients = new Set(admissions.map((a) => a.hn)).size

  const stats = [
    { label: 'เคสทั้งหมด', value: total.toLocaleString() },
    { label: 'กำลังนอนอยู่', value: active.toLocaleString() },
    { label: 'จำนวนผู้ป่วย', value: uniquePatients.toLocaleString() },
    { label: 'LOS เฉลี่ย (วัน)', value: avgLos.toLocaleString() },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink/50">{s.label}</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{s.value}</p>
        </div>
      ))}
    </div>
  )
}

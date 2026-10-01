import type { Admission } from '../lib/types'

export default function StatCards({ admissions }: { admissions: Admission[] }) {
  // 1 encounter อาจมีหลายแถว (แยกสิทธิ) — นับเคสตาม encounter_id ไม่ซ้ำ
  const encounters = Array.from(new Map(admissions.map((a) => [a.encounter_id, a])).values())
  const total = encounters.length
  const avgLos =
    total === 0
      ? 0
      : Math.round((encounters.reduce((sum, a) => sum + (a.los ?? 0), 0) / total) * 10) / 10
  const uniquePatients = new Set(admissions.map((a) => a.hn)).size

  const stats = [
    { label: 'เคสทั้งหมด', value: total.toLocaleString() },
    { label: 'จำนวนผู้ป่วย', value: uniquePatients.toLocaleString() },
    { label: 'LOS เฉลี่ย (วัน)', value: avgLos.toLocaleString() },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">{s.label}</p>
          <p className="mt-1 text-3xl font-bold text-ink">{s.value}</p>
        </div>
      ))}
    </div>
  )
}

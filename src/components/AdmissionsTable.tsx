import type { Admission } from '../lib/types'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ClaimStatus({ admission }: { admission: Admission }) {
  const ct = admission.case_tracking
  const steps: { key: string; label: string; done: boolean }[] = [
    { key: 'doc', label: 'รับเอกสาร', done: !!ct?.document_received_date },
    { key: 'audit', label: 'Audit', done: !!ct?.audit_date },
    { key: 'submit', label: 'ส่งเบิก', done: !!ct?.submission_date },
  ]
  return (
    <div className="flex items-center gap-1">
      {steps.map((s) => (
        <span
          key={s.key}
          title={s.label}
          className={
            'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
            (s.done ? 'bg-teal-soft text-teal-dark' : 'bg-paper text-ink/40')
          }
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

interface Props {
  admissions: Admission[]
  loading: boolean
  isAdmin: boolean
  onEdit: (a: Admission) => void
}

export default function AdmissionsTable({ admissions, loading, isAdmin, onEdit }: Props) {
  if (loading) {
    return <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/50">กำลังโหลดข้อมูล…</div>
  }

  if (admissions.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/50">
        ไม่พบเคสที่ตรงกับเงื่อนไขค้นหา
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink/50">
            <th className="px-4 py-3 font-medium">HN</th>
            <th className="px-4 py-3 font-medium">ชื่อผู้ป่วย</th>
            <th className="px-4 py-3 font-medium">วันรับ</th>
            <th className="px-4 py-3 font-medium">วันจำหน่าย</th>
            <th className="px-4 py-3 font-medium">หอผู้ป่วย</th>
            <th className="px-4 py-3 font-medium text-right">LOS</th>
            <th className="px-4 py-3 font-medium">สิทธิการรักษา</th>
            <th className="px-4 py-3 font-medium">ผู้จ่าย</th>
            <th className="px-4 py-3 font-medium">สถานะเคลม</th>
            {isAdmin && <th className="px-4 py-3 font-medium text-right">แก้ไข</th>}
          </tr>
        </thead>
        <tbody>
          {admissions.map((a) => (
            <tr key={a.encounter_id} className="border-b border-line last:border-0 hover:bg-paper/60">
              <td className="px-4 py-3 font-mono text-xs text-ink/70">{a.hn}</td>
              <td className="px-4 py-3 text-ink">{a.patients?.full_name ?? '—'}</td>
              <td className="px-4 py-3 text-ink/80">{fmtDate(a.admit_date)}</td>
              <td className="px-4 py-3 text-ink/80">
                {a.discharge_date ? (
                  fmtDate(a.discharge_date)
                ) : (
                  <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-medium text-amber">
                    กำลังนอน
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-ink/70">{a.division_code ?? '—'}</td>
              <td className="px-4 py-3 text-right text-ink/80">{a.los ?? '—'}</td>
              <td className="px-4 py-3 text-ink/80">{a.coverage_master?.coverage_name ?? '—'}</td>
              <td className="px-4 py-3 text-ink/70">{a.payer_master?.payer_name ?? '—'}</td>
              <td className="px-4 py-3">
                <ClaimStatus admission={a} />
              </td>
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onEdit(a)}
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink/70 hover:bg-paper"
                  >
                    แก้ไข
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

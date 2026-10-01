import { useState } from 'react'
import type { Admission } from '../lib/types'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

function ClaimStatus({
  admission,
  canReceive,
  onReceiveDoc,
}: {
  admission: Admission
  canReceive: boolean
  onReceiveDoc: (a: Admission) => Promise<void>
}) {
  const [receiving, setReceiving] = useState(false)
  const ct = admission.case_tracking
  const steps: { key: string; label: string; done: boolean; title: string }[] = [
    { key: 'doc', label: 'รับเอกสาร', done: !!ct?.document_received_date, title: ct?.document_received_date ? `รับเอกสาร ${fmtDate(ct.document_received_date)}` : 'รับเอกสาร' },
    { key: 'audit', label: 'Audit', done: !!ct?.audit_date, title: ct?.audit_date ? `Audit ${fmtDate(ct.audit_date)}${ct.audit_amount != null ? ` · ${ct.audit_amount.toLocaleString()} บาท` : ''}` : 'Audit' },
    {
      key: 'submit',
      label: 'ส่งเบิก',
      done: !!ct?.submission_date,
      title: ct?.submission_date
        ? `ส่งเบิก ${fmtDate(ct.submission_date)}${ct.claim_no ? ` · เลขที่ ${ct.claim_no}` : ''}`
        : 'ส่งเบิก',
    },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s) =>
        s.key === 'doc' && !s.done && canReceive ? (
          <button
            key={s.key}
            type="button"
            disabled={receiving}
            title="คลิกเพื่อบันทึกว่ารับเอกสารวันนี้"
            onClick={async () => {
              setReceiving(true)
              try {
                await onReceiveDoc(admission)
              } finally {
                setReceiving(false)
              }
            }}
            className="rounded-full border border-ink bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors hover:bg-brand disabled:opacity-50"
          >
            {receiving ? 'กำลังบันทึก…' : 'รับเอกสาร'}
          </button>
        ) : (
        <span
          key={s.key}
          title={s.title}
          className={
            'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ' +
            (s.done ? 'bg-brand text-ink font-semibold' : 'border border-line bg-surface text-ink/45')
          }
        >
          {s.label}
        </span>
        ),
      )}
    </div>
  )
}

interface Props {
  admissions: Admission[]
  loading: boolean
  isAdmin: boolean
  onEdit: (a: Admission) => void
  onReceiveDoc: (a: Admission) => Promise<void>
}

export default function AdmissionsTable({ admissions, loading, isAdmin, onEdit, onReceiveDoc }: Props) {
  if (loading) {
    return <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">กำลังโหลดข้อมูล…</div>
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
      <table className="w-full min-w-[900px] text-left text-sm 2xl:min-w-0">
        <thead>
          <tr className="bg-brand text-[13px] text-ink">
            <th className="whitespace-nowrap px-3 py-3 font-semibold">encounter_id</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">HN</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">ชื่อผู้ป่วย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">วันรับ</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">วันจำหน่าย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">หอผู้ป่วย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">LOS</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สิทธิการรักษา</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">ผู้จ่าย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สถานะเคลม</th>
            {isAdmin && <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">แก้ไข</th>}
          </tr>
        </thead>
        <tbody>
          {admissions.map((a) => (
            <tr key={a.admission_id} className="border-b border-line last:border-0 hover:bg-paper">
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">{a.encounter_id}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink">{a.hn}</td>
              <td className="min-w-[9rem] break-words px-3 py-2.5 text-ink">{a.patients?.full_name ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtDate(a.admit_date)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                {fmtDate(a.discharge_date)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink">{a.division_code ?? '—'}</td>
              <td className="px-3 py-2.5 text-right text-ink">{a.los ?? '—'}</td>
              <td className="min-w-[10rem] break-words px-3 py-2.5 text-ink">
                <span className="mr-1.5 font-mono text-[13px] font-semibold text-ink">{a.coverage_code}</span>
                {a.coverage_master?.coverage_name ?? ''}
              </td>
              <td className="min-w-[8rem] break-words px-3 py-2.5 text-ink">{a.payer_master?.payer_name ?? '—'}</td>
              <td className="px-3 py-2.5">
                <ClaimStatus admission={a} canReceive={isAdmin} onReceiveDoc={onReceiveDoc} />
              </td>
              {isAdmin && (
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => onEdit(a)}
                    className="rounded-md border border-ink/40 px-3 py-1 text-sm font-medium text-ink hover:bg-brand"
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

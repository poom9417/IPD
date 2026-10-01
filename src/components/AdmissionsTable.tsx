import { useState } from 'react'
import type { Admission } from '../lib/types'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ClaimStatus({
  admission,
  canReceive,
  onReceiveDoc,
}: {
  admission: Admission
  canReceive: boolean
  onReceiveDoc: (a: Admission, amount: number) => Promise<boolean>
}) {
  const [entering, setEntering] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [amount, setAmount] = useState('')
  const ct = admission.case_tracking

  const amountNum = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum >= 0

  async function confirm() {
    if (!amountValid || receiving) return
    setReceiving(true)
    try {
      const ok = await onReceiveDoc(admission, amountNum)
      if (ok) {
        setEntering(false)
        setAmount('')
      }
    } finally {
      setReceiving(false)
    }
  }

  function cancel() {
    setEntering(false)
    setAmount('')
  }

  const steps: { key: string; label: string; done: boolean; title: string }[] = [
    {
      key: 'doc',
      label: 'รับเอกสาร',
      done: !!ct?.document_received_date,
      title: ct?.document_received_date
        ? `รับเอกสาร ${fmtDate(ct.document_received_date)}${
            ct.document_received_amount != null ? ` · ${ct.document_received_amount.toLocaleString()} บาท` : ''
          }`
        : 'รับเอกสาร',
    },
    {
      key: 'audit',
      label: 'Audit',
      done: !!ct?.audit_date,
      title: ct?.audit_date ? `Audit ${fmtDate(ct.audit_date)}` : 'Audit',
    },
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
    <div className="flex items-center gap-1">
      {steps.map((s) => {
        if (s.key === 'doc' && !s.done && canReceive) {
          return entering ? (
            <span key={s.key} className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="ยอด (บาท)"
                value={amount}
                disabled={receiving}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    confirm()
                  } else if (e.key === 'Escape') {
                    cancel()
                  }
                }}
                className="w-24 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/30"
              />
              <button
                type="button"
                title="ยืนยันรับเอกสารวันนี้"
                disabled={!amountValid || receiving}
                onClick={confirm}
                className="rounded-full bg-teal-dark px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
              >
                {receiving ? '…' : '✓'}
              </button>
              <button
                type="button"
                title="ยกเลิก"
                disabled={receiving}
                onClick={cancel}
                className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink/60 hover:bg-paper disabled:opacity-40"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              key={s.key}
              type="button"
              title="คลิกเพื่อกรอกยอดและบันทึกว่ารับเอกสารวันนี้"
              onClick={() => setEntering(true)}
              className="rounded-full border border-teal-dark/40 bg-surface px-2 py-0.5 text-[11px] font-medium text-teal-dark transition-colors hover:bg-teal-soft"
            >
              รับเอกสาร
            </button>
          )
        }
        return (
          <span
            key={s.key}
            title={s.title}
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
              (s.done ? 'bg-teal-soft text-teal-dark' : 'bg-paper text-ink/40')
            }
          >
            {s.label}
          </span>
        )
      })}
    </div>
  )
}

interface Props {
  admissions: Admission[]
  loading: boolean
  isAdmin: boolean
  onEdit: (a: Admission) => void
  onReceiveDoc: (a: Admission, amount: number) => Promise<boolean>
}

export default function AdmissionsTable({ admissions, loading, isAdmin, onEdit, onReceiveDoc }: Props) {
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
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink/50">
            <th className="px-4 py-3 font-medium">encounter_id</th>
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
            <tr key={a.admission_id} className="border-b border-line last:border-0 hover:bg-paper/60">
              <td className="px-4 py-3 font-mono text-xs font-medium text-ink">{a.encounter_id}</td>
              <td className="px-4 py-3 font-mono text-xs text-ink/70">{a.hn}</td>
              <td className="px-4 py-3 text-ink">{a.patients?.full_name ?? '—'}</td>
              <td className="px-4 py-3 text-ink/80">{fmtDate(a.admit_date)}</td>
              <td className="px-4 py-3 text-ink/80">
                {fmtDate(a.discharge_date)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-ink/70">{a.division_code ?? '—'}</td>
              <td className="px-4 py-3 text-right text-ink/80">{a.los ?? '—'}</td>
              <td className="px-4 py-3 text-ink/80">
                <span className="mr-1.5 font-mono text-xs font-medium text-ink">{a.coverage_code}</span>
                {a.coverage_master?.coverage_name ?? ''}
              </td>
              <td className="px-4 py-3 text-ink/70">{a.payer_master?.payer_name ?? '—'}</td>
              <td className="px-4 py-3">
                <ClaimStatus admission={a} canReceive={isAdmin} onReceiveDoc={onReceiveDoc} />
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

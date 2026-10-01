import { useEffect, type ReactNode } from 'react'
import type { Admission } from '../lib/types'
import { CLAIM_STAGE_LABELS, getClaimStage } from '../lib/claimStatus'

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })
}

function fmtTime(t: string | null | undefined) {
  return t ? t.slice(0, 5) : '—'
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท'
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

interface Props {
  admission: Admission
  onClose: () => void
  /** ส่งมาเฉพาะ role ที่แก้ไขได้ (admin) — จะมีปุ่ม "แก้ไข" ในหน้าต่างนี้ */
  onEdit?: (a: Admission) => void
}

/** หน้าต่างดูรายละเอียดเคส — หน้าตาเหมือนฟอร์มแก้ไข แต่แก้ไขไม่ได้ (read-only) */
export default function CaseDetailModal({ admission: a, onClose, onEdit }: Props) {
  const ct = a.case_tracking
  const stage = getClaimStage(a)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-5">
          <div>
            <h2 className="text-base font-semibold text-ink">รายละเอียดเคส</h2>
            <p className="mt-0.5 text-sm text-ink/60">ดูข้อมูลอย่างเดียว — แก้ไขไม่ได้</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Encounter ID" mono>{a.encounter_id}</Field>
            <Field label="AN" mono>{a.an}</Field>
          </div>

          <Field label="HN" mono>{a.hn}</Field>
          <Field label="ชื่อผู้ป่วย">{a.patients?.full_name ?? '—'}</Field>
          <Field label="วันเกิด">{fmtDate(a.patients?.birthdate)}</Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="วันรับเข้า">{fmtDate(a.admit_date)}</Field>
            <Field label="เวลารับเข้า">{fmtTime(a.admit_time)}</Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="วันจำหน่าย">{fmtDate(a.discharge_date)}</Field>
            <Field label="เวลาจำหน่าย">{fmtTime(a.discharge_time)}</Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="หอผู้ป่วย (division)" mono>{a.division_code ?? '—'}</Field>
            <Field label="LOS (วัน)">{a.los ?? '—'}</Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="สิทธิการรักษา">
              <span className="font-mono font-semibold">{a.coverage_code}</span>
              {a.coverage_master?.coverage_name ? ` — ${a.coverage_master.coverage_name}` : ''}
            </Field>
            <Field label="ผู้จ่าย (payer)">
              <span className="font-mono font-semibold">{a.payer_id}</span>
              {a.payer_master?.payer_name ? ` — ${a.payer_master.payer_name}` : ''}
            </Field>
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink/80">สถานะเคลม</p>
              <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-ink">
                {CLAIM_STAGE_LABELS[stage]}
              </span>
            </div>

            <Field label="วันที่รับเอกสาร">{fmtDate(ct?.document_received_date)}</Field>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="วันที่ Audit">{fmtDate(ct?.audit_date)}</Field>
              <Field label="ยอด Audit">{fmtMoney(ct?.audit_amount)}</Field>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="วันที่ส่งเบิก">{fmtDate(ct?.submission_date)}</Field>
              <Field label="ยอดส่งเบิก">{fmtMoney(ct?.submission_amount)}</Field>
            </div>

            <div className="mt-3">
              <Field label="เลขที่ใบส่งเบิก (claim_no)" mono>{ct?.claim_no || '—'}</Field>
            </div>

            {ct?.updated_at && (
              <p className="mt-2 text-sm text-ink/60">แก้ไขล่าสุด {fmtDateTime(ct.updated_at)}</p>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line px-6 py-3">
          <div className="flex justify-end gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(a)}
                className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand"
              >
                แก้ไข
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink/80">{label}</span>
      <div
        className={
          'min-h-[2.5rem] break-words rounded-lg border border-line bg-paper px-3 py-2 text-[0.9375rem] text-ink ' +
          (mono ? 'font-mono text-[13px]' : '')
        }
      >
        {children}
      </div>
    </div>
  )
}

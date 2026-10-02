import { useState } from 'react'
import type { Admission } from '../lib/types'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ---- จำนวนวันหลัง Audit ----
// นับเป็น "วันตามปฏิทิน" (ตัดเวลาออก) กันเลื่อนเพราะ timezone
function dayNumber(ymd: string | null | undefined): number | null {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null
}

function todayDayNumber(): number {
  const n = new Date()
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86_400_000
}

/**
 * ยังไม่ส่งเบิก  → วันนี้ − วัน Audit        (pending = true: ค้างอยู่ ตัวเลขยังเดินต่อ)
 * ส่งเบิกแล้ว    → วันส่งเบิก − วัน Audit    (pending = false: ตัวเลขนิ่งแล้ว)
 * ยังไม่มีวัน Audit → null (แสดง —)
 */
function daysAfterAudit(
  ct: Admission['case_tracking'],
  today: number,
): { days: number; pending: boolean } | null {
  const audit = dayNumber(ct?.audit_date)
  if (audit === null) return null
  const submitted = dayNumber(ct?.submission_date)
  return submitted === null ? { days: today - audit, pending: true } : { days: submitted - audit, pending: false }
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ClaimStatus({
  admission,
  canReceive,
  onReceiveDoc,
  canAudit,
  onAuditToday,
}: {
  admission: Admission
  canReceive: boolean
  onReceiveDoc: (a: Admission, amount: number) => Promise<boolean>
  canAudit: boolean
  onAuditToday: (a: Admission) => Promise<void>
}) {
  const [entering, setEntering] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [amount, setAmount] = useState('')
  const [auditing, setAuditing] = useState(false)
  const ct = admission.case_tracking

  const amountNum = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum >= 0

  async function confirmReceive() {
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

  function cancelReceive() {
    setEntering(false)
    setAmount('')
  }

  // กำลังกรอกยอดรับเอกสาร: แสดงเฉพาะช่องกรอก (ซ่อนป้ายอื่นชั่วคราวให้พอดีคอลัมน์)
  if (entering && !ct?.document_received_date && canReceive) {
    return (
      <div className="flex flex-nowrap items-center gap-1">
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="ยอด claim จาก HIS (บาท)"
          value={amount}
          disabled={receiving}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void confirmReceive()
            } else if (e.key === 'Escape') {
              cancelReceive()
            }
          }}
          className="w-32 rounded-md border border-ink/40 bg-surface px-2 py-0.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
        />
        <button
          type="button"
          title="ยืนยัน: รับเอกสารวันนี้"
          disabled={!amountValid || receiving}
          onClick={() => void confirmReceive()}
          className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-ink hover:bg-brand-dark disabled:opacity-40"
        >
          {receiving ? '…' : '✓'}
        </button>
        <button
          type="button"
          title="ยกเลิก"
          disabled={receiving}
          onClick={cancelReceive}
          className="rounded-full border border-ink/40 px-2 py-0.5 text-xs text-ink hover:bg-brand-soft disabled:opacity-40"
        >
          ✕
        </button>
      </div>
    )
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
    { key: 'audit', label: 'Audit', done: !!ct?.audit_date, title: ct?.audit_date ? `Audit ${fmtDate(ct.audit_date)}` : 'Audit' },
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
    <div className="flex flex-nowrap items-center gap-1">
      {steps.map((s) =>
        s.key === 'audit' && !s.done && canAudit ? (
          <button
            key={s.key}
            type="button"
            disabled={auditing}
            title="คลิกเพื่อบันทึกว่า Audit วันนี้"
            onClick={async () => {
              setAuditing(true)
              try {
                await onAuditToday(admission)
              } finally {
                setAuditing(false)
              }
            }}
            className="rounded-full border border-ink bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors hover:bg-brand disabled:opacity-50"
          >
            {auditing ? 'กำลังบันทึก…' : 'Audit'}
          </button>
        ) : s.key === 'doc' && !s.done && canReceive ? (
          <button
            key={s.key}
            type="button"
            title="คลิกเพื่อกรอกยอดและบันทึกว่ารับเอกสารวันนี้"
            onClick={() => setEntering(true)}
            className="rounded-full border border-ink bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors hover:bg-brand"
          >
            รับเอกสาร
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
  /** admin + user กดปุ่ม "รับเอกสาร" ได้ (audit / viewer ไม่ได้) */
  canReceive?: boolean
  onEdit: (a: Admission) => void
  /** คลิกที่แถว = เปิดหน้าต่างดูรายละเอียด (ทุก role) */
  onView?: (a: Admission) => void
  /** กรอกยอดรับเอกสารแล้วบันทึก — คืน true เมื่อสำเร็จ */
  onReceiveDoc: (a: Admission, amount: number) => Promise<boolean>
  /** role audit (หรือ admin) กดบันทึกวัน Audit = วันนี้ได้ */
  canAudit?: boolean
  onAuditToday?: (a: Admission) => Promise<void>
}

// ความกว้างคอลัมน์แบบล็อก (px) — ตารางจะไม่ขยับตามความยาวข้อมูล
// ลำดับ: encounter_id, HN, ชื่อผู้ป่วย, วันรับ, วันจำหน่าย, วัน Audit, ค้างเบิก(วัน), สิทธิ, ยอด claim จาก HIS, สถานะเคลม, (แก้ไข)
const COL_WIDTHS = [114, 82, 150, 94, 94, 94, 104, 180, 140, 215]
const EDIT_COL_WIDTH = 76

export default function AdmissionsTable({
  admissions,
  loading,
  isAdmin,
  canReceive = false,
  onEdit,
  onView,
  onReceiveDoc,
  canAudit = false,
  onAuditToday = async () => {},
}: Props) {
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

  const today = todayDayNumber()
  const widths = isAdmin ? [...COL_WIDTHS, EDIT_COL_WIDTH] : COL_WIDTHS
  const minWidth = widths.reduce((sum, w) => sum + w, 0)

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full table-fixed text-left text-sm" style={{ minWidth }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-brand text-[13px] text-ink">
            <th className="whitespace-nowrap px-3 py-3 font-semibold">encounter_id</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">HN</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">ชื่อผู้ป่วย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">วันรับ</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">วันจำหน่าย</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">วัน Audit</th>
            <th
              className="whitespace-nowrap px-3 py-3 text-right font-semibold"
              title="ยังไม่ส่งเบิก = วันนี้ − วัน Audit · ส่งเบิกแล้ว = วันส่งเบิก − วัน Audit"
            >
              ค้างเบิก (วัน)
            </th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สิทธิการรักษา</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">ยอด claim จาก HIS</th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สถานะเคลม</th>
            {isAdmin && <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">แก้ไข</th>}
          </tr>
        </thead>
        <tbody>
          {admissions.map((a) => (
            <tr
              key={a.admission_id}
              onClick={() => onView?.(a)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onView?.(a)
                }
              }}
              tabIndex={onView ? 0 : undefined}
              title={onView ? 'คลิกเพื่อดูรายละเอียดเคส' : undefined}
              className={'border-b border-line last:border-0 hover:bg-paper ' + (onView ? 'cursor-pointer' : '')}
            >
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">{a.encounter_id}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink">{a.hn}</td>
              <td className="break-words px-3 py-2.5 text-ink">{a.patients?.full_name ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtDate(a.admit_date)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                {fmtDate(a.discharge_date)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtDate(a.case_tracking?.audit_date ?? null)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">
                {(() => {
                  const aging = daysAfterAudit(a.case_tracking, today)
                  if (!aging) return '—'
                  return aging.pending ? (
                    <span
                      className="inline-block min-w-8 rounded-full bg-alert px-2.5 py-0.5 text-center font-bold text-white"
                      title={`ยังไม่ส่งเบิก — Audit มาแล้ว ${aging.days} วัน`}
                    >
                      {aging.days}
                    </span>
                  ) : (
                    <span
                      className="inline-block min-w-8 rounded-full bg-brand px-2.5 py-0.5 text-center font-bold text-ink"
                      title={`ส่งเบิกแล้ว — ใช้เวลา ${aging.days} วันหลัง Audit`}
                    >
                      {aging.days}
                    </span>
                  )
                })()}
              </td>
              <td className="break-words px-3 py-2.5 text-ink">
                <span className="mr-1.5 font-mono text-[13px] font-semibold text-ink">{a.coverage_code}</span>
                {a.coverage_master?.coverage_name ?? ''}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                {fmtMoney(a.case_tracking?.document_received_amount)}
              </td>
              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                <ClaimStatus admission={a} canReceive={canReceive} onReceiveDoc={onReceiveDoc} canAudit={canAudit} onAuditToday={onAuditToday} />
              </td>
              {isAdmin && (
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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

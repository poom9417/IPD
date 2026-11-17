import { useState } from 'react'
import type { Admission } from '../lib/types'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ---- จำนวนวันค้างเบิก (นับจากวันจำหน่าย) ----
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
 * ยังไม่ส่งเบิก  → วันนี้ − วันจำหน่าย         (pending = true: ค้างอยู่ ตัวเลขยังเดินต่อ)
 * ส่งเบิกแล้ว    → วันส่งเบิก − วันจำหน่าย     (pending = false: ตัวเลขนิ่งแล้ว)
 * ยังไม่มีวันจำหน่าย → null (แสดง —)
 * ไม่เกี่ยวกับวัน Audit แล้ว
 */
function daysAfterDischarge(
  dischargeDate: string | null | undefined,
  ct: Admission['case_tracking'],
  today: number,
): { days: number; pending: boolean } | null {
  const discharge = dayNumber(dischargeDate)
  if (discharge === null) return null
  const submitted = dayNumber(ct?.submission_date)
  return submitted === null
    ? { days: today - discharge, pending: true }
    : { days: submitted - discharge, pending: false }
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
  onEditReceive,
  showMoney = true,
}: {
  admission: Admission
  showMoney?: boolean
  canReceive: boolean
  onReceiveDoc: (a: Admission) => Promise<boolean>
  onEditReceive?: (a: Admission) => void
  canAudit: boolean
  onAuditToday: (a: Admission) => Promise<void>
}) {
  const [receiving, setReceiving] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const ct = admission.case_tracking

  // กด "รับเอกสาร" = บันทึกวันที่วันนี้ทันที (ไม่ต้องกรอกยอด — ยอดมาจากไฟล์ HIS ที่ admin/developer นำเข้า)
  async function confirmReceive() {
    if (receiving) return
    setReceiving(true)
    try {
      await onReceiveDoc(admission)
    } finally {
      setReceiving(false)
    }
  }

  const steps: { key: string; label: string; done: boolean; title: string }[] = [
    {
      key: 'doc',
      label: 'รับเอกสาร',
      done: !!ct?.document_received_date,
      title: ct?.document_received_date
        ? `รับเอกสาร ${fmtDate(ct.document_received_date)}${
            showMoney && ct.document_received_amount != null ? ` · ${ct.document_received_amount.toLocaleString()} บาท` : ''
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
            title="คลิกเพื่อบันทึกว่ารับเอกสารวันนี้"
            disabled={receiving}
            onClick={() => void confirmReceive()}
            className="rounded-full border border-ink bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors hover:bg-brand disabled:opacity-50"
          >
            {receiving ? 'กำลังบันทึก…' : 'รับเอกสาร'}
          </button>
        ) : s.key === 'doc' && s.done && canReceive && onEditReceive ? (
          <button
            key={s.key}
            type="button"
            title={`${s.title} — คลิกเพื่อแก้ไขวันที่รับเอกสาร`}
            onClick={() => onEditReceive(admission)}
            className="whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors hover:bg-brand-dark"
          >
            รับเอกสาร ✎
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
  /** กดรับเอกสาร = บันทึกวันที่วันนี้ (ไม่ต้องกรอกยอด) — คืน true เมื่อสำเร็จ */
  onReceiveDoc: (a: Admission) => Promise<boolean>
  /** แก้ไขวันที่รับเอกสารที่บันทึกไปแล้ว (admin + user) */
  onEditReceive?: (a: Admission) => void
  /** role audit (หรือ admin) กดบันทึกวัน Audit = วันนี้ได้ */
  canAudit?: boolean
  onAuditToday?: (a: Admission) => Promise<void>
  /** false = ซ่อนยอดเงินทุกจุด (role audit) */
  showMoney?: boolean
}

// ความกว้างคอลัมน์แบบล็อก (px) — ตารางจะไม่ขยับตามความยาวข้อมูล
// ลำดับ: encounter_id, HN, ชื่อผู้ป่วย, วันรับ, วันจำหน่าย, วัน Audit, ค้างเบิก(วัน), สิทธิ, ยอดเงินจาก HIS, สถานะเคลม, (แก้ไข)
const COL_WIDTHS = [114, 82, 150, 94, 94, 94, 104, 180, 140, 232]
const EDIT_COL_WIDTH = 76

export default function AdmissionsTable({
  admissions,
  loading,
  isAdmin,
  canReceive = false,
  onEdit,
  onView,
  onReceiveDoc,
  onEditReceive,
  canAudit = false,
  onAuditToday = async () => {},
  showMoney = true,
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
  const baseWidths = showMoney ? COL_WIDTHS : COL_WIDTHS.filter((_, i) => i !== 8)
  const widths = isAdmin ? [...baseWidths, EDIT_COL_WIDTH] : baseWidths
  const minWidth = widths.reduce((sum, w) => sum + w, 0)

  return (
    <div data-tour="cases-table" className="overflow-x-auto rounded-xl border border-line bg-surface">
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
              title="ยังไม่ส่งเบิก = วันนี้ − วันจำหน่าย · ส่งเบิกแล้ว = วันส่งเบิก − วันจำหน่าย"
            >
              ค้างเบิก (วัน)
            </th>
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สิทธิการรักษา</th>
            {showMoney && <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">ยอดเงินจาก HIS</th>}
            <th className="whitespace-nowrap px-3 py-3 font-semibold">สถานะเคลม</th>
            {isAdmin && <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">แก้ไข</th>}
          </tr>
        </thead>
        <tbody>
          {admissions.map((a, rowIdx) => (
            <tr
              key={a.admission_id}
              data-tour={rowIdx === 0 ? 'first-row' : undefined}
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
                  const aging = daysAfterDischarge(a.discharge_date, a.case_tracking, today)
                  if (!aging) return '—'
                  return aging.pending ? (
                    <span
                      className="inline-block min-w-8 rounded-full bg-alert px-2.5 py-0.5 text-center font-bold text-white"
                      title={`ยังไม่ส่งเบิก — จำหน่ายมาแล้ว ${aging.days} วัน`}
                    >
                      {aging.days}
                    </span>
                  ) : (
                    <span
                      className="inline-block min-w-8 rounded-full bg-brand px-2.5 py-0.5 text-center font-bold text-ink"
                      title={`ส่งเบิกแล้ว — ใช้เวลา ${aging.days} วันหลังจำหน่าย`}
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
              {showMoney && (
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                {fmtMoney(a.case_tracking?.document_received_amount)}
              </td>
              )}
              <td className="px-3 py-2.5" data-tour={rowIdx === 0 ? 'claim-status' : undefined} onClick={(e) => e.stopPropagation()}>
                <ClaimStatus admission={a} showMoney={showMoney} canReceive={canReceive} onReceiveDoc={onReceiveDoc} onEditReceive={onEditReceive} canAudit={canAudit} onAuditToday={onAuditToday} />
              </td>
              {isAdmin && (
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    data-tour={rowIdx === 0 ? 'edit-btn' : undefined}
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

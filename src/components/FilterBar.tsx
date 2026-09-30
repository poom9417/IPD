import CoverageMultiSelect from './CoverageMultiSelect'
import { CLAIM_STAGE_LABELS, type ClaimStage } from '../lib/claimStatus'
import type { CoverageMaster, PayerMaster } from '../lib/types'

interface Props {
  search: string
  onSearchChange: (v: string) => void
  division: string
  onDivisionChange: (v: string) => void
  divisions: string[]
  dischargeFrom: string
  onDischargeFromChange: (v: string) => void
  dischargeTo: string
  onDischargeToChange: (v: string) => void
  coverageOptions: CoverageMaster[]
  coverages: string[]
  onCoveragesChange: (v: string[]) => void
  payerOptions: PayerMaster[]
  payer: string
  onPayerChange: (v: string) => void
  claimStage: ClaimStage | ''
  onClaimStageChange: (v: ClaimStage | '') => void
  onClear: () => void
  hasActiveFilter: boolean
}

const inputCls =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/30'

const chipCls =
  'rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink/70 hover:bg-paper transition-colors'

// วันที่แบบ YYYY-MM-DD ตามเวลาท้องถิ่น (ไม่ใช้ toISOString เพราะเลื่อนเป็น UTC)
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function FilterBar({
  search,
  onSearchChange,
  division,
  onDivisionChange,
  divisions,
  dischargeFrom,
  onDischargeFromChange,
  dischargeTo,
  onDischargeToChange,
  coverageOptions,
  coverages,
  onCoveragesChange,
  payerOptions,
  payer,
  onPayerChange,
  claimStage,
  onClaimStageChange,
  onClear,
  hasActiveFilter,
}: Props) {
  function setRange(from: Date, to: Date) {
    onDischargeFromChange(ymd(from))
    onDischargeToChange(ymd(to))
  }

  const now = new Date()
  const presets: { label: string; apply: () => void }[] = [
    {
      label: 'วันนี้',
      apply: () => setRange(now, now),
    },
    {
      label: '7 วันล่าสุด',
      apply: () => setRange(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), now),
    },
    {
      label: 'เดือนนี้',
      apply: () => setRange(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    },
    {
      label: 'เดือนที่แล้ว',
      apply: () => setRange(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหา HN, AN, ชื่อ หรือ encounter_id…"
          className={inputCls + ' w-full placeholder:text-ink/40 sm:w-64'}
        />

        <select value={division} onChange={(e) => onDivisionChange(e.target.value)} className={inputCls}>
          <option value="">ทุกหอผู้ป่วย</option>
          {divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          value={claimStage}
          onChange={(e) => onClaimStageChange(e.target.value as ClaimStage | '')}
          className={inputCls}
        >
          <option value="">ทุกสถานะเคลม</option>
          {(Object.keys(CLAIM_STAGE_LABELS) as ClaimStage[]).map((k) => (
            <option key={k} value={k}>
              {CLAIM_STAGE_LABELS[k]}
            </option>
          ))}
        </select>

        <select value={payer} onChange={(e) => onPayerChange(e.target.value)} className={inputCls + ' max-w-[220px]'}>
          <option value="">ทุกผู้จ่าย</option>
          {payerOptions.map((p) => (
            <option key={p.payer_id} value={p.payer_id}>
              {p.payer_id} — {p.payer_name}
            </option>
          ))}
        </select>

        <div className="text-xs text-ink/60">
          <div className="mb-1">สิทธิ (เลือกได้หลายอัน)</div>
          <CoverageMultiSelect options={coverageOptions} value={coverages} onChange={onCoveragesChange} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink/60">
          <div className="mb-1">วันจำหน่าย: เริ่ม</div>
          <input type="date" value={dischargeFrom} onChange={(e) => onDischargeFromChange(e.target.value)} className={inputCls} />
        </label>

        <label className="text-xs text-ink/60">
          <div className="mb-1">สิ้นสุด</div>
          <input
            type="date"
            value={dischargeTo}
            min={dischargeFrom || undefined}
            onChange={(e) => onDischargeToChange(e.target.value)}
            className={inputCls}
          />
        </label>

        <div className="flex flex-wrap gap-1.5 pb-1.5">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={p.apply} className={chipCls}>
              {p.label}
            </button>
          ))}
        </div>

        {hasActiveFilter && (
          <button type="button" onClick={onClear} className="pb-2 text-sm text-ink/60 underline hover:text-ink">
            ล้าง filter
          </button>
        )}
      </div>
    </div>
  )
}

import CoverageMultiSelect from './CoverageMultiSelect'
import type { CoverageMaster } from '../lib/types'

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
  onClear: () => void
  hasActiveFilter: boolean
}

const inputCls =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/30'

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
  onClear,
  hasActiveFilter,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="ค้นหา HN, ชื่อ หรือ encounter_id…"
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

      <div className="text-xs text-ink/60">
        <div className="mb-1">สิทธิ (เลือกได้หลายอัน)</div>
        <CoverageMultiSelect options={coverageOptions} value={coverages} onChange={onCoveragesChange} />
      </div>

      {hasActiveFilter && (
        <button type="button" onClick={onClear} className="pb-2 text-sm text-ink/60 underline hover:text-ink">
          ล้าง filter
        </button>
      )}
    </div>
  )
}

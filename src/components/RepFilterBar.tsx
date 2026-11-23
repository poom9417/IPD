import { useMemo } from 'react'
import DateInput from './DateInput'
import MultiSelectBox from './MultiSelectBox'
import Button from './ui/Button'
import { EMPTY_FILTERS, hasFilters, type PairOption, type RepFilters } from '../lib/repFilters'

interface Props {
  value: RepFilters
  onChange: (f: RepFilters) => void
  pairs: PairOption[]
  coverageNames: Map<string, string>
  payerNames: Map<string, string>
}

const dateCls = 'w-full rounded-lg border border-ink/25 bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60'

function Range({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink/70">{label}</div>
      <div className="flex items-start gap-1.5">
        <DateInput value={from} onChange={onFrom} className={dateCls} title="จากวันที่ (ถ้าเลือกช่องเดียว = วันนั้นวันเดียว)" />
        <span className="pt-2 text-xs text-ink/50">ถึง</span>
        <DateInput value={to} onChange={onTo} min={from || undefined} className={dateCls} />
      </div>
    </div>
  )
}

export default function RepFilterBar({ value, onChange, pairs, coverageNames, payerNames }: Props) {
  const set = (patch: Partial<RepFilters>) => onChange({ ...value, ...patch })

  const coverageOptions = useMemo(
    () =>
      [...new Set(pairs.map((p) => p.coverageCode))]
        .sort()
        .map((c) => ({ value: c, label: coverageNames.get(c) ?? '' })),
    [pairs, coverageNames],
  )
  // ผู้จ่ายที่เลือกได้ = เฉพาะผู้จ่ายของสิทธิที่เลือกไว้ (ถ้ายังไม่เลือกสิทธิ = ทุกผู้จ่าย)
  const payerOptions = useMemo(
    () =>
      [...new Set(pairs.filter((p) => value.coverages.length === 0 || value.coverages.includes(p.coverageCode)).map((p) => p.payerId))]
        .sort()
        .map((p) => ({ value: p, label: payerNames.get(p) ?? '' })),
    [pairs, value.coverages, payerNames],
  )

  function changeCoverages(cov: string[]) {
    // ตัดผู้จ่ายที่ไม่อยู่ในสิทธิที่เลือกใหม่ออก
    const allowed = new Set(pairs.filter((p) => cov.length === 0 || cov.includes(p.coverageCode)).map((p) => p.payerId))
    set({ coverages: cov, payers: value.payers.filter((p) => allowed.has(p)) })
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs font-semibold text-ink/70">สิทธิ</div>
          <MultiSelectBox options={coverageOptions} value={value.coverages} onChange={changeCoverages} allLabel="ทุกสิทธิ" unit="สิทธิ" searchPlaceholder="ค้นหารหัสหรือชื่อสิทธิ…" />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-ink/70">ผู้จ่าย (payer)</div>
          <MultiSelectBox options={payerOptions} value={value.payers} onChange={(payers) => set({ payers })} allLabel="ทุกผู้จ่าย" unit="ผู้จ่าย" searchPlaceholder="ค้นหารหัสหรือชื่อผู้จ่าย…" />
        </div>
        {hasFilters(value) && (
          <Button type="button" variant="outline" onClick={() => onChange(EMPTY_FILTERS)}>
            ล้างตัวกรอง
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3 pb-3">
        <Range label="วันที่จำหน่าย" from={value.dischargeFrom} to={value.dischargeTo} onFrom={(v) => set({ dischargeFrom: v })} onTo={(v) => set({ dischargeTo: v })} />
        <Range label="วันที่ส่งเบิก" from={value.submitFrom} to={value.submitTo} onFrom={(v) => set({ submitFrom: v })} onTo={(v) => set({ submitTo: v })} />
        <Range label="วันที่กองทุนตอบกลับ" from={value.replyFrom} to={value.replyTo} onFrom={(v) => set({ replyFrom: v })} onTo={(v) => set({ replyTo: v })} />
      </div>
    </div>
  )
}

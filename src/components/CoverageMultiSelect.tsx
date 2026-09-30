import { useEffect, useRef, useState } from 'react'
import type { CoverageMaster } from '../lib/types'

interface Props {
  options: CoverageMaster[]
  value: string[]
  onChange: (v: string[]) => void
}

export default function CoverageMultiSelect({ options, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  const label =
    value.length === 0
      ? 'ทุกสิทธิ (coverage_code)'
      : value.length <= 2
        ? value.join(', ')
        : `เลือกแล้ว ${value.length} สิทธิ`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-[200px] rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/30"
      >
        <span className={value.length === 0 ? 'text-ink/60' : ''}>{label}</span>
        <span className="float-right text-ink/40">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-auto rounded-lg border border-line bg-surface p-2 shadow-lg">
          <div className="mb-1 flex justify-between px-2 text-xs">
            <button type="button" className="text-teal-dark hover:underline" onClick={() => onChange(options.map((o) => o.coverage_code))}>
              เลือกทั้งหมด
            </button>
            <button type="button" className="text-teal-dark hover:underline" onClick={() => onChange([])}>
              ล้าง
            </button>
          </div>
          {options.map((o) => (
            <label key={o.coverage_code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper">
              <input type="checkbox" checked={value.includes(o.coverage_code)} onChange={() => toggle(o.coverage_code)} />
              <span className="font-mono text-xs font-medium text-ink">{o.coverage_code}</span>
              <span className="truncate text-ink/60">{o.coverage_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

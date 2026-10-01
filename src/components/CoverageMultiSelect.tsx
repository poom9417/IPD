import { useEffect, useMemo, useRef, useState } from 'react'
import type { CoverageMaster } from '../lib/types'

interface Props {
  options: CoverageMaster[]
  value: string[]
  onChange: (v: string[]) => void
}

export default function CoverageMultiSelect({ options, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // ปิดแล้วล้างคำค้นหา
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.coverage_code.toLowerCase().includes(q) || o.coverage_name.toLowerCase().includes(q),
    )
  }, [options, query])

  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  // "เลือกทั้งหมด" = เลือกทุกตัวที่เห็นอยู่ในรายการ (หลังค้นหา) รวมกับที่เลือกไว้เดิม
  function selectVisible() {
    onChange(Array.from(new Set([...value, ...visible.map((o) => o.coverage_code)])))
  }

  const label =
    value.length === 0
      ? 'ทุกสิทธิ'
      : value.length <= 2
        ? value.join(', ')
        : `เลือกแล้ว ${value.length} สิทธิ`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="min-w-[200px] rounded-lg border border-ink/25 bg-surface px-3 py-2 text-left text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60"
      >
        <span className={value.length === 0 ? 'text-ink/60' : ''}>{label}</span>
        <span className="float-right text-ink/40">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-80 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหารหัสหรือชื่อสิทธิ…"
            className="input mb-1.5 py-1.5 text-xs"
          />
          <div className="mb-1 flex justify-between px-2 text-xs">
            <button type="button" className="text-ink font-semibold hover:underline" onClick={selectVisible}>
              {query ? `เลือกที่ค้นเจอ (${visible.length})` : 'เลือกทั้งหมด'}
            </button>
            <button type="button" className="text-ink font-semibold hover:underline" onClick={() => onChange([])}>
              ล้าง
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            {visible.length === 0 && <p className="px-2 py-3 text-center text-sm text-ink/70">ไม่พบสิทธิที่ค้นหา</p>}
            {visible.map((o) => (
              <label
                key={o.coverage_code}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper"
              >
                <input type="checkbox" checked={value.includes(o.coverage_code)} onChange={() => toggle(o.coverage_code)} />
                <span className="font-mono text-xs font-medium text-ink">{o.coverage_code}</span>
                <span className="truncate text-ink/60">{o.coverage_name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

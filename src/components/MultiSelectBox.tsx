import { useEffect, useMemo, useRef, useState } from 'react'

export interface MultiOption {
  value: string
  label: string
}

interface Props {
  options: MultiOption[]
  value: string[]
  onChange: (v: string[]) => void
  /** ข้อความเมื่อยังไม่เลือกอะไร (= ทั้งหมด) เช่น "ทุกสิทธิ" */
  allLabel: string
  /** ข้อความหน่วยเมื่อเลือกหลายค่า เช่น "สิทธิ" */
  unit: string
  searchPlaceholder?: string
}

/** กล่องเลือกหลายค่าแบบค้นหาได้ — หน้าตาเดียวกับ CoverageMultiSelect แต่ใช้กับข้อมูลชนิดอื่นได้ (เช่น ผู้จ่าย) */
export default function MultiSelectBox({ options, value, onChange, allLabel, unit, searchPlaceholder = 'ค้นหา…' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  const label = value.length === 0 ? allLabel : value.length <= 2 ? value.join(', ') : `เลือกแล้ว ${value.length} ${unit}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="min-w-[180px] rounded-lg border border-ink/25 bg-surface px-3 py-2 text-left text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60"
      >
        <span className={value.length === 0 ? 'text-ink/60' : ''}>{label}</span>
        <span className="float-right text-ink/40">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-80 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="form-input mb-1.5 py-1.5 text-xs" />
          <div className="mb-1 flex justify-between px-2 text-xs">
            <button type="button" className="font-semibold text-ink hover:underline" onClick={() => onChange(Array.from(new Set([...value, ...visible.map((o) => o.value)])))}>
              {query ? `เลือกที่ค้นเจอ (${visible.length})` : 'เลือกทั้งหมด'}
            </button>
            <button type="button" className="font-semibold text-ink hover:underline" onClick={() => onChange([])}>
              ล้าง
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            {visible.length === 0 && <p className="px-2 py-3 text-center text-sm text-ink/70">ไม่พบรายการ</p>}
            {visible.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="font-mono text-xs font-medium text-ink">{o.value}</span>
                <span className="truncate text-ink/60">{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

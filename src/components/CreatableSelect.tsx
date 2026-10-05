import { useEffect, useMemo, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  /** กดปุ่ม "เพิ่มใหม่" — ส่งคำที่พิมพ์ค้นไว้ไปให้ฟอร์มเพิ่ม */
  onAddClick: (typed: string) => void
  addLabel: string
  /** ถ้าใส่ จะมีตัวเลือก "ไม่ระบุ" (ค่าว่าง) ให้เลือก */
  emptyLabel?: string
}

export default function CreatableSelect({ value, options, onChange, onAddClick, addLabel, emptyLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const all = useMemo(
    () => (emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options),
    [options, emptyLabel],
  )
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? all.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : all
  }, [all, q])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  function openList() {
    setQ('')
    setActive(Math.max(0, all.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  function choose(v: string) {
    onChange(v)
    setOpen(false)
  }

  function add() {
    setOpen(false)
    onAddClick(q.trim())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[active]) choose(filtered[active].value)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    }
  }

  const current = all.find((o) => o.value === value)

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        className="input flex items-center justify-between text-left"
      >
        <span className={`truncate ${current ? '' : 'text-ink/50'}`}>{current?.label ?? (value || 'เลือก…')}</span>
        <span className="ml-2 text-xs text-ink/50">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-line bg-surface shadow-lg">
          <div className="border-b border-line p-2">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="พิมพ์เพื่อค้นหา…"
              autoComplete="off"
              className="input"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink/60">ไม่พบรายการที่ตรงกัน</p>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value || '__empty'}
                  type="button"
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setActive(i)}
                  className={`block w-full px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-soft' : ''} ${
                    o.value === value ? 'font-semibold' : ''
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={add}
            className="block w-full border-t border-line px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-brand-soft"
          >
            ＋ {addLabel}
            {q.trim() && <span className="font-normal text-ink/60"> “{q.trim()}”</span>}
          </button>
        </div>
      )}
    </div>
  )
}

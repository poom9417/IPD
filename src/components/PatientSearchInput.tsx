import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Patient } from '../lib/types'

interface Props {
  /** ช่องนี้ค้นหาด้วยอะไร: hn หรือ ชื่อผู้ป่วย */
  field: 'hn' | 'name'
  value: string
  onText: (v: string) => void
  onPick: (p: Patient) => void
  disabled?: boolean
  required?: boolean
  /** ปิดการค้นหา (เช่น โหมดแก้ไขเคส) */
  searchEnabled?: boolean
}

// escape ตัวอักษรพิเศษของ LIKE
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m)

export default function PatientSearchInput({ field, value, onText, onPick, disabled, required, searchEnabled = true }: Props) {
  const [results, setResults] = useState<Patient[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const skipNext = useRef(false) // หลังเลือกจากรายการ ไม่ต้องค้นหาซ้ำจากค่าที่เพิ่งใส่

  useEffect(() => {
    if (!searchEnabled || disabled) return
    if (skipNext.current) {
      skipNext.current = false
      return
    }
    const q = value.trim()
    if (q.length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(async () => {
      const col = field === 'hn' ? 'hn' : 'full_name'
      const { data } = await supabase
        .from('patients')
        .select('hn, full_name, birthdate')
        .ilike(col, `%${escapeLike(q)}%`)
        .order(col)
        .limit(8)
      if (id !== reqId.current) return // มีคำค้นใหม่กว่าแล้ว
      setResults((data ?? []) as Patient[])
      setActive(0)
      setOpen(true)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [value, field, searchEnabled, disabled])

  // คลิกนอกกล่อง = ปิดรายการ
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(p: Patient) {
    skipNext.current = true
    setOpen(false)
    setResults([])
    onPick(p)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault() // ไม่ให้ฟอร์มถูก submit ตอนกำลังเลือกรายชื่อ
      pick(results[active])
    } else if (e.key === 'Escape') {
      e.stopPropagation() // ปิดแค่รายการ ไม่ปิดหน้าต่างฟอร์ม
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={searchEnabled ? (field === 'hn' ? 'พิมพ์ HN เพื่อค้นหา…' : 'พิมพ์ชื่อเพื่อค้นหา…') : undefined}
        autoComplete="off"
        className="input"
      />
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink/60">
              {loading ? 'กำลังค้นหา…' : 'ไม่พบผู้ป่วยเดิม — กรอกต่อเพื่อเพิ่มผู้ป่วยใหม่'}
            </p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.hn}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(p)
                }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-soft' : 'hover:bg-brand-soft'}`}
              >
                <span className="font-mono font-medium">{p.hn}</span>
                <span className="ml-2">{p.full_name}</span>
                {p.birthdate && <span className="ml-2 text-ink/50">· เกิด {p.birthdate}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

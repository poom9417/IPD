import { useEffect, useRef, useState } from 'react'
import { formatTyping, isoToDisplay, parseDisplayDate } from '../lib/dateInput'

interface Props {
  /** ISO YYYY-MM-DD (ค.ศ.) หรือ '' เมื่อยังไม่เลือก */
  value: string
  /** เรียกเมื่อกรอกครบ วัน/เดือน/ปี และถูกต้องเท่านั้น (หรือ '' เมื่อล้างช่อง) */
  onChange: (iso: string) => void
  min?: string
  max?: string
  className?: string
  title?: string
}

/**
 * ช่องกรอกวันที่แบบ วว/ดด/ปปปป (ค.ศ.)
 * - ต้องกรอกครบ วัน เดือน ปี จึงจะนำไป filter (กรอกไม่ครบ = ยังไม่ filter)
 * - กรอกปี พ.ศ. (เช่น 06/11/2569) → แก้เป็น ค.ศ. (06/11/2026) ให้ทันที
 * - มีปุ่มปฏิทินให้เลือกวันได้ด้วย
 */
export default function DateInput({ value, onChange, min, max, className = '', title }: Props) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const [error, setError] = useState('')
  const pickerRef = useRef<HTMLInputElement>(null)

  // ค่าจากภายนอกเปลี่ยน (ปุ่ม preset / ล้าง filter) → อัปเดตข้อความในช่อง
  useEffect(() => {
    const cur = parseDisplayDate(text)
    if ((cur?.iso ?? '') !== value) {
      setText(isoToDisplay(value))
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function rangeError(iso: string): string {
    if (min && iso < min) return `ต้องไม่ก่อน ${isoToDisplay(min)}`
    if (max && iso > max) return `ต้องไม่เกิน ${isoToDisplay(max)}`
    return ''
  }

  function handleChange(raw: string) {
    const formatted = formatTyping(raw, raw.length >= text.length)

    if (formatted === '') {
      setText('')
      setError('')
      if (value !== '') onChange('')
      return
    }

    const parsed = parseDisplayDate(formatted)
    if (parsed) {
      setText(parsed.text) // ถ้ากรอก พ.ศ. ตรงนี้จะเป็น ค.ศ. แล้ว
      const re = rangeError(parsed.iso)
      setError(re)
      if (!re && parsed.iso !== value) onChange(parsed.iso)
      return
    }

    setText(formatted)
    // ปีครบ 4 หลักแล้วแต่ยังอ่านไม่ได้ = วันที่ไม่มีจริง
    setError(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(formatted) ? 'วันที่ไม่ถูกต้อง' : '')
  }

  function handleBlur() {
    if (text !== '' && !parseDisplayDate(text) && !error) setError('กรอกให้ครบ วว/ดด/ปปปป')
  }

  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
      el.click()
    }
  }

  return (
    <span className="relative inline-block w-[10.5rem] align-top">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="วว/ดด/ปปปป"
        maxLength={10}
        title={title ?? 'กรอก วัน/เดือน/ปี ให้ครบ (ถ้ากรอกเป็น พ.ศ. ระบบจะแปลงเป็น ค.ศ. ให้)'}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className={`${className} w-full pr-9 ${error ? '!border-alert focus:!ring-alert/50' : ''}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="เลือกจากปฏิทิน"
        onClick={openPicker}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-ink/60 hover:bg-brand/30 hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      {/* ตัวเลือกปฏิทินของเบราว์เซอร์ (ซ่อนไว้ ใช้เฉพาะตอนกดปุ่มปฏิทิน) */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => {
          const v = e.target.value
          if (v) {
            setText(isoToDisplay(v))
            setError('')
            onChange(v)
          }
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
      {error && (
        <span className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap text-xs text-alert">{error}</span>
      )}
    </span>
  )
}

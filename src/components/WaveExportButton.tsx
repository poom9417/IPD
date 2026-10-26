import { useEffect, useRef, useState } from 'react'

type Status = 'idle' | 'morphing' | 'loading' | 'success' | 'fail'

interface Props {
  /** ฟังก์ชันส่งออกจริง — throw เมื่อล้มเหลว */
  onExport: () => Promise<void>
  /** ข้อความตอนว่าง (ข้างปุ่ม) */
  label: string
  disabled?: boolean
  title?: string
  /** ใช้กับ OnboardingTour */
  dataTour?: string
}

const MIN_LOADING_MS = 1400 // ให้เห็นอนิเมชันคลื่นอย่างน้อยช่วงหนึ่ง แม้ export เสร็จเร็ว
const MORPH_MS = 600
const SUCCESS_RESET_MS = 1800
const FAIL_RESET_MS = 1600

const STATUS_TEXT: Record<Exclude<Status, 'idle'>, string> = {
  morphing: 'กำลังส่งออก…',
  loading: 'กำลังส่งออก…',
  success: 'ส่งออกสำเร็จ',
  fail: 'ส่งออกไม่สำเร็จ',
}

const WAVE_A =
  'M2 18 C6 10, 10 26, 14 18 C18 10, 22 26, 26 18 C30 10, 34 26, 38 18 C42 10, 46 26, 50 18'
const WAVE_B =
  'M2 18 C6 25, 10 10, 14 18 C18 25, 22 10, 26 18 C30 25, 34 10, 38 18 C42 25, 46 10, 50 18'

/** ปุ่ม Export แบบ WaveDownload: ไอคอนดาวน์โหลด → เส้น → คลื่นโหลด → ติ๊กถูก / กากบาท (สั่น+แดง) */
export default function WaveExportButton({ onExport, label, disabled, title, dataTour }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const timers = useRef<number[]>([])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      timers.current.forEach(clearTimeout)
    }
  }, [])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(() => alive.current && fn(), ms))
  }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  async function handleClick() {
    if (disabled) return
    if (status === 'success') {
      setStatus('idle')
      return
    }
    if (status !== 'idle') return

    setStatus('morphing')
    later(() => setStatus((s) => (s === 'morphing' ? 'loading' : s)), MORPH_MS)

    const started = Date.now()
    try {
      await onExport()
      await sleep(Math.max(0, MORPH_MS + MIN_LOADING_MS - (Date.now() - started)))
      if (!alive.current) return
      setStatus('success')
      later(() => setStatus('idle'), SUCCESS_RESET_MS)
    } catch (err) {
      await sleep(Math.max(0, MORPH_MS + 600 - (Date.now() - started)))
      if (!alive.current) return
      setStatus('fail')
      later(() => setStatus('idle'), FAIL_RESET_MS)
      alert(`Export ไม่สำเร็จ: ${(err as { message?: string })?.message ?? err}`)
    }
  }

  const busy = status === 'morphing' || status === 'loading'
  const text = status === 'idle' ? label : STATUS_TEXT[status]

  return (
    <span className="wd-wrap" data-tour={dataTour} title={title}>
      <button
        type="button"
        className={`wd-btn${status === 'fail' ? ' wd-fail-anim' : ''}`}
        onClick={handleClick}
        disabled={disabled || busy}
        aria-label={label}
        aria-busy={busy}
      >
        <span className={`wd-bg${status === 'fail' ? ' wd-bg-fail' : ''}`} />
        <span className="wd-ring" />

        {/* ดาวน์โหลด */}
        <svg
          className={`wd-icon wd-download${status === 'idle' ? ' is-active' : ''}${busy ? ' is-leaving' : ''}`}
          viewBox="0 0 42 42"
          fill="none"
          aria-hidden="true"
        >
          <path d="M21 6V27" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M12 19L21 28L30 19" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 35H34" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        </svg>

        {/* เส้น morph */}
        {status === 'morphing' && <span className="wd-line" />}

        {/* คลื่นโหลด (mount ตอนโหลด → SMIL เริ่มเล่นทุกเบราว์เซอร์) */}
        {status === 'loading' && (
          <span className="wd-wave">
            <svg viewBox="0 0 52 36" fill="none" aria-hidden="true">
              <path d={WAVE_A} className="wd-wave-glow">
                <animate attributeName="d" dur="0.8s" repeatCount="indefinite" values={`${WAVE_A};${WAVE_B};${WAVE_A}`} />
              </path>
              <path d={WAVE_A} className="wd-wave-path">
                <animate attributeName="d" dur="0.8s" repeatCount="indefinite" values={`${WAVE_A};${WAVE_B};${WAVE_A}`} />
              </path>
            </svg>
            <span className="wd-dots">•••</span>
          </span>
        )}

        {/* สำเร็จ */}
        {status === 'success' && (
          <svg className="wd-icon wd-success" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M10 21L17 28L31 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

        {/* ล้มเหลว */}
        {status === 'fail' && (
          <svg className="wd-icon wd-failx" viewBox="0 0 38 38" fill="none" aria-hidden="true">
            <path d="M10 10L28 28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M28 10L10 28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <span key={status} className={`wd-text wd-text-${status}`} role="status" aria-live="polite">
        {text}
      </span>
    </span>
  )
}

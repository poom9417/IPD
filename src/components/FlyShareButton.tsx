import { useEffect, useRef, useState } from 'react'
import type { PushStatus } from '../lib/sheetSync'

// สไตล์อยู่ที่ src/styles/components/flyshare.css (class ขึ้นต้น flyshare-)

type View = 'idle' | 'sending' | 'shared' | 'error'

interface Props {
  /** สถานะการส่งจริงจาก useSheetPush — ปุ่มเล่นอนิเมชันตามสถานะนี้ (ไม่ใช่ตั้งเวลาเอง) */
  status: PushStatus
  /** สั่งส่งไป Google Sheet */
  onPush: () => void
  /** ข้อความตอนว่าง */
  label?: string
  title?: string
  disabled?: boolean
  /** ใช้กับ OnboardingTour */
  dataTour?: string
}

const MIN_FLIGHT_MS = 1200 // ให้เครื่องบินบินจบอย่างน้อยหนึ่งรอบ แม้ส่งเสร็จเร็ว
const RESULT_MS = 1800 // โชว์ "ส่งแล้ว" / "ไม่สำเร็จ" นานเท่านี้แล้วกลับสู่ปกติ
const NO_START_MS = 1500 // กดแล้วไม่มีการส่งเริ่มจริง → กลับสู่ปกติ

const TEXT: Record<View, string> = {
  idle: 'ส่งไป Google Sheet',
  sending: 'กำลังส่ง…',
  shared: 'ส่งแล้ว',
  error: 'ไม่สำเร็จ',
}

/** ปุ่ม flyshare: ไอคอนแชร์ → เครื่องบินกระดาษบินออก → ติ๊กถูก (หรือกากบาทสั่นถ้าส่งไม่สำเร็จ) */
export default function FlyShareButton({ status, onPush, label = TEXT.idle, title, disabled, dataTour }: Props) {
  const [view, setView] = useState<View>('idle')
  const startedAt = useRef(0)
  const sawRunning = useRef(false)
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

  // ตามสถานะการส่งจริง — รวมถึงการส่งอัตโนมัติ (หลังนำเข้าเคส/แก้เคส) ที่ไม่ได้เริ่มจากการกดปุ่มนี้
  useEffect(() => {
    if (status.phase === 'running') {
      sawRunning.current = true
      if (view !== 'sending') {
        startedAt.current = Date.now()
        setView('sending')
      }
      return
    }
    if ((status.phase === 'ok' || status.phase === 'error') && view === 'sending' && sawRunning.current) {
      sawRunning.current = false
      const result: View = status.phase === 'ok' ? 'shared' : 'error'
      const wait = Math.max(0, MIN_FLIGHT_MS - (Date.now() - startedAt.current))
      later(() => {
        setView(result)
        later(() => setView('idle'), RESULT_MS)
      }, wait)
    }
  }, [status.phase, status.at, view])

  function handleClick() {
    if (disabled || view !== 'idle') return
    startedAt.current = Date.now()
    sawRunning.current = status.phase === 'running'
    setView('sending')
    onPush()
    // กันค้าง: ถ้าสั่งแล้วไม่มีการส่งเริ่มจริง (เช่น ถูกปิดสิทธิ์) ให้กลับสู่ปกติ
    later(() => setView((v) => (v === 'sending' && !sawRunning.current ? 'idle' : v)), NO_START_MS)
  }

  return (
    <span className="flyshare-wrap" data-tour={dataTour} title={title}>
      <button
        type="button"
        className="flyshare-btn"
        data-state={view}
        onClick={handleClick}
        disabled={disabled || view === 'sending'}
        aria-label={label}
        aria-busy={view === 'sending'}
      >
        <span className="flyshare-glow" />

        <span className="flyshare-content">
          <span className="flyshare-icon-area">
            {/* ไอคอนแชร์ปกติ */}
            <span className="flyshare-share-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="18" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="6" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="18" cy="19" r="2.3" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8.2 10.8L15.8 6.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M8.2 13.2L15.8 17.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>

            {/* เครื่องบินกระดาษ */}
            <span className="flyshare-plane">
              <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
                <path d="M4 20L35 4L25 35L18 23L4 20Z" fill="white" />
                <path d="M18 23L35 4" stroke="#777" strokeWidth="1.5" />
                <path d="M18 23L20 31" stroke="#999" strokeWidth="1.5" />
              </svg>
            </span>

            <span className="flyshare-trail flyshare-trail-1" />
            <span className="flyshare-trail flyshare-trail-2" />

            <span className="flyshare-particle flyshare-p1" />
            <span className="flyshare-particle flyshare-p2" />
            <span className="flyshare-particle flyshare-p3" />
            <span className="flyshare-particle flyshare-p4" />
            <span className="flyshare-particle flyshare-p5" />
            <span className="flyshare-particle flyshare-p6" />
            <span className="flyshare-particle flyshare-p7" />

            {/* สำเร็จ */}
            <span className="flyshare-result flyshare-result-ok">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12.5L9.5 17L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>

            {/* ไม่สำเร็จ */}
            <span className="flyshare-result flyshare-result-fail">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 7L17 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </span>
          </span>

          <span className="flyshare-text" role="status" aria-live="polite">
            <span className="flyshare-label flyshare-label-idle">{label}</span>
            <span className="flyshare-label flyshare-label-sending">{TEXT.sending}</span>
            <span className="flyshare-label flyshare-label-shared">{TEXT.shared}</span>
            <span className="flyshare-label flyshare-label-error">{TEXT.error}</span>
          </span>

          <span className="flyshare-arrow" aria-hidden="true">
            ↗
          </span>
        </span>
      </button>
    </span>
  )
}

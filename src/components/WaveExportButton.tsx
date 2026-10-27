import { useEffect, useRef, useState } from 'react'

// สไตล์อยู่ในไฟล์นี้เอง (ฝังด้วย <style>) ปุ่มจึงทำงานได้ไม่ว่า index.css จะถูกแก้หรือไม่
const WD_CSS = `
/* ===== WaveExportButton (ปุ่ม Export แบบ WaveDownload) ===== */
.wd-wrap {
  --wd-size: 44px;
  --wd-bg: var(--color-brand);
  --wd-fg: var(--color-ink);
  --wd-fail: #ef4444;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}
.wd-btn {
  position: relative;
  flex: none;
  width: var(--wd-size);
  height: var(--wd-size);
  padding: 0;
  border: none;
  outline: none;
  border-radius: 999px;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  color: var(--wd-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center;
  -webkit-tap-highlight-color: transparent;
}
.wd-btn:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ink) 45%, transparent);
}
.wd-btn:disabled { cursor: default; }
.wd-wrap:has(.wd-btn:disabled:not([aria-busy='true'])) { opacity: 0.4; }

.wd-bg {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--wd-bg);
  box-shadow: 0 0 14px color-mix(in srgb, var(--wd-bg) 45%, transparent);
  transition: transform 0.2s ease;
}
.wd-btn:not(:disabled):hover .wd-bg { transform: scale(1.06); }
.wd-bg-fail { animation: wdFailBg 0.8s ease forwards; }
.wd-btn:has(.wd-bg-fail) { color: #fff; }
.wd-ring {
  position: absolute;
  inset: 10%;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--wd-fg) 22%, transparent);
  pointer-events: none;
  z-index: 2;
}

.wd-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46%;
  height: 46%;
  transform: translate(-50%, -50%);
  z-index: 10;
  pointer-events: none;
}
.wd-download {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.5);
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.wd-download.is-active { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.wd-download.is-leaving { opacity: 0; transform: translate(-50%, -50%) scale(0.4) rotate(90deg); }

.wd-line {
  position: absolute;
  left: 50%;
  top: 50%;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
  transform: translate(-50%, -50%);
  z-index: 10;
  animation: wdLine 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes wdLine {
  from { width: 0; opacity: 0; }
  to { width: 40%; opacity: 1; }
}

.wd-wave {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 56%;
  transform: translate(-50%, -50%);
  z-index: 10;
  pointer-events: none;
  animation: wdFade 0.25s ease forwards;
}
.wd-wave svg { display: block; width: 100%; height: auto; overflow: visible; }
@keyframes wdFade { from { opacity: 0; } to { opacity: 1; } }
.wd-wave-path { fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
.wd-wave-glow { fill: none; stroke: currentColor; stroke-width: 7; stroke-linecap: round; opacity: 0.14; }
.wd-dots {
  position: absolute;
  left: 50%;
  bottom: -3px;
  transform: translateX(-50%);
  font-size: 7px;
  line-height: 1;
  opacity: 0.8;
  animation: wdDots 1s ease-in-out infinite;
}
@keyframes wdDots { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

.wd-success { animation: wdPop 0.35s ease-out forwards; }
.wd-success path { stroke-dasharray: 100; stroke-dashoffset: 100; animation: wdDraw 0.55s ease-out forwards; }
.wd-failx { opacity: 0; animation: wdPop 0.35s ease-out 0.15s forwards; }
.wd-failx path { stroke-dasharray: 100; stroke-dashoffset: 100; animation: wdDraw 0.25s ease-out forwards; }
.wd-failx path:last-child { animation-delay: 0.12s; }
@keyframes wdPop {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes wdDraw { to { stroke-dashoffset: 0; } }

.wd-fail-anim { animation: wdFailBtn 0.8s ease-in-out forwards; }
@keyframes wdFailBtn {
  0% { transform: scaleX(1); }
  45% { transform: scaleX(0.12); }
  70% { transform: scaleX(0.55); }
  100% { transform: scaleX(1); }
}
@keyframes wdFailBg {
  0% { background: var(--color-brand); }
  45%, 100% { background: var(--wd-fail); box-shadow: 0 0 18px rgba(239, 68, 68, 0.6); }
}

.wd-text {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-ink);
  animation: wdTextIn 0.3s ease both;
}
.wd-text-loading, .wd-text-morphing { color: color-mix(in srgb, var(--color-ink) 60%, transparent); }
.wd-text-fail { color: #dc2626; }
@keyframes wdTextIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .wd-btn, .wd-bg, .wd-download, .wd-line, .wd-wave, .wd-success, .wd-failx, .wd-text, .wd-dots { animation-duration: 0.01s !important; transition-duration: 0.01s !important; }
}
`

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

  return (
    <span className="wd-wrap" data-tour={dataTour} title={title}>
      <style>{WD_CSS}</style>
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

      {/* ตอนว่างไม่แสดงข้อความ (label ใช้เป็น aria-label) — แสดงเฉพาะสถานะระหว่าง/หลังส่งออก */}
      {status !== 'idle' && (
        <span key={status} className={`wd-text wd-text-${status}`} role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      )}
    </span>
  )
}

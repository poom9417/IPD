import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type MineMode = 'main' | 'dashboard'

const MODES: { key: MineMode; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'dashboard', label: 'Dashboard' },
]

interface Props {
  mode: MineMode
  onChange: (m: MineMode) => void
}

const itemCls = 'relative z-10 rounded-full px-3 py-1 text-sm font-semibold sm:px-4'

/**
 * ปุ่มสลับโหมดแบบ Pill Indicator (อ้างอิง motion-reference "catalog-ui-control-pill-indicator")
 * - แท็บเม็ดสีเหลืองเลื่อนไปครอบแท็บที่เลือก ด้วยการเคลื่อนไหวแบบสปริง (stiffness 240 / damping 24)
 * - ตัวอักษรเปลี่ยนสีเฉพาะส่วนที่อยู่ในเม็ด: ซ้อนป้ายสีดำอีกชั้นไว้ในเม็ดที่ overflow:hidden
 *   (ชั้นในเลื่อนสวนทางกับเม็ดด้วย easing เดียวกัน ตัวอักษรจึงอยู่กับที่)
 */
export default function ModeTabs({ mode, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Partial<Record<MineMode, HTMLButtonElement | null>>>({})
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; tw: number; th: number } | null>(null)
  const [ready, setReady] = useState(false)

  const measure = useCallback(() => {
    const track = trackRef.current
    const btn = btnRefs.current[mode]
    if (!track || !btn) return
    setBox({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight, tw: track.clientWidth, th: track.clientHeight })
  }, [mode])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  // วัดใหม่เมื่อขนาดเปลี่ยน (หน้าจอ / ฟอนต์โหลดเสร็จ) — ไม่เล่นอนิเมชันตอนวัดครั้งแรก
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [measure])

  useLayoutEffect(() => {
    if (box && !ready) {
      const id = requestAnimationFrame(() => setReady(true))
      return () => cancelAnimationFrame(id)
    }
  }, [box, ready])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = MODES.findIndex((m) => m.key === mode)
    const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length]
    onChange(next.key)
    btnRefs.current[next.key]?.focus()
  }

  const anim = ready ? 'mode-pill' : ''

  return (
    <div
      ref={trackRef}
      data-tour="mode-tabs"
      role="tablist"
      aria-label="โหมดหน้าหลัก"
      onKeyDown={onKeyDown}
      className="relative inline-flex rounded-full border border-white/30 bg-white/5 p-0.5"
    >
      {/* เม็ดเลื่อน + ป้ายสีดำซ้อนอยู่ข้างใน */}
      {box && (
        <span
          aria-hidden
          className={'pointer-events-none absolute z-0 overflow-hidden rounded-full bg-brand ' + anim}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
          <span
            className={'absolute flex p-0.5 ' + anim}
            style={{ left: -box.x, top: -box.y, width: box.tw, height: box.th }}
          >
            {MODES.map((m) => (
              <span key={m.key} className={itemCls + ' text-ink'}>
                {m.label}
              </span>
            ))}
          </span>
        </span>
      )}

      {MODES.map((m) => {
        const active = mode === m.key
        return (
          <button
            key={m.key}
            ref={(el) => {
              btnRefs.current[m.key] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(m.key)}
            className={
              itemCls +
              ' transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
              // ก่อนวัดตำแหน่งเสร็จยังไม่มีเม็ด ให้ปุ่มที่เลือกมีสีของตัวเองไว้ก่อน
              (active ? (box ? 'text-transparent' : 'bg-brand text-ink') : 'text-white/75 hover:text-white')
            }
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  /** ป้ายสำหรับโปรแกรมอ่านหน้าจอ */
  label: string
  /** ไอคอนในช่องสีดำด้านซ้าย */
  icon: ReactNode
  /** ตัวเลข badge มุมไอคอน (ไม่ใส่ = ไม่แสดง) */
  count?: number
  title: string
  children?: ReactNode
  /** ปุ่มด้านล่าง — รับฟังก์ชัน close() ที่ปิดการ์ดพร้อมแอนิเมชัน */
  actions: (close: () => void) => ReactNode
  /** เรียกเมื่อการ์ดปิดจบแล้ว (กดปุ่ม / Esc / ครบเวลา) */
  onClosed: () => void
  /** ใส่เวลา (ms) = มีแถบนับเวลาแล้วปิดเอง หยุดนับเมื่อชี้เมาส์/โฟกัสอยู่ */
  autoCloseMs?: number
  className?: string
}

/** การ์ดแจ้งเตือนสไตล์เดียวกับ NewUserPopup — ใช้ซ้ำทุกจุดที่เป็นการ์ดมุมจอ */
export default function NoticeCard({ label, icon, count, title, children, actions, onClosed, autoCloseMs, className = '' }: Props) {
  const [closing, setClosing] = useState(false)
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function close() {
    if (closing) return
    if (reduced()) onClosed()
    else setClosing(true)
  }

  // ปิดเองเมื่อครบเวลา โดยหยุดนับตอนเมาส์อยู่บนการ์ด — ใช้แถบ CSS เป็นตัวนับ (onAnimationEnd) ส่วน reduced-motion ใช้ timer แทน
  useEffect(() => {
    if (!autoCloseMs || !reduced()) return
    const t = setTimeout(onClosed, autoCloseMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCloseMs])

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') close()
  }

  return (
    <section
      aria-label={label}
      data-closing={closing}
      onKeyDown={onKeyDown}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) onClosed()
      }}
      className={
        'anim-pop-in pointer-events-auto overflow-hidden rounded-2xl border border-line border-t-4 border-t-brand bg-surface shadow-xl ' +
        className
      }
    >
      <div className="flex items-start gap-3.5 p-4">
        <div className="relative shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-brand">{icon}</div>
          {count !== undefined && (
            <span
              key={count}
              aria-hidden="true"
              className="badge-pop absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-ink bg-brand px-1 font-mono text-xs font-bold text-ink ring-2 ring-surface"
            >
              {count}
            </span>
          )}
        </div>
        <div role="status" className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <div className="mt-0.5 text-sm text-ink/70">{children}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-4 pb-4">{actions(close)}</div>
      {autoCloseMs ? (
        <div className="h-1 bg-brand-soft" aria-hidden="true">
          <div
            className="timer-bar h-full bg-brand-dark"
            style={{ animationDuration: `${autoCloseMs}ms` }}
            onAnimationEnd={close}
          />
        </div>
      ) : null}
    </section>
  )
}

/** ปุ่มมาตรฐานของการ์ด/หน้าต่างสไตล์นี้ */
export const btnGhost =
  'min-h-11 rounded-lg border border-ink/40 px-4 text-sm font-medium text-ink transition-colors hover:bg-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40'
export const btnPrimary =
  'min-h-11 rounded-lg border border-ink bg-brand px-5 text-sm font-semibold text-ink transition-colors hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:opacity-40'
export const btnDanger =
  'min-h-11 rounded-lg border border-ink bg-alert px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:opacity-40'

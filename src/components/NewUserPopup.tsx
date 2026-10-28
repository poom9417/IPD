import { useEffect, useState, type KeyboardEvent } from 'react'

export interface PendingUser {
  id: string
  email: string
}

interface Props {
  /** ผู้ใช้ที่ยังรออนุมัติทั้งหมด (app_users ที่ approval_status = pending) */
  users: PendingUser[]
  /** กด "ตรวจสอบ" → เปิดหน้าอนุมัติ/จัดการผู้ใช้ */
  onReview: () => void
}

const STORAGE_KEY = 'ipd.newUserPopup.seen'

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeen(s: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s).slice(-200)))
  } catch {
    /* storage ใช้ไม่ได้ — ข้าม */
  }
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <circle cx="10" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19c.6-3.2 3.2-5 6.5-5s5.9 1.8 6.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19 8v6M16 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Popup มุมขวาบน แจ้งเฉพาะ "ผู้ใช้ใหม่ที่ยังไม่เคยแจ้ง" — ผู้ใช้เก่าที่ค้างอยู่จะไม่เด้งซ้ำ
 * จำรายการที่แจ้งแล้วไว้ใน localStorage ของเครื่องแอดมินคนนั้น
 */
export default function NewUserPopup({ users, onReview }: Props) {
  const [seen, setSeen] = useState<Set<string>>(readSeen)
  const [closing, setClosing] = useState(false)

  const fresh = users.filter((u) => !seen.has(u.id))
  const count = fresh.length

  function commit() {
    const next = new Set(seen)
    fresh.forEach((u) => next.add(u.id))
    writeSeen(next)
    setSeen(next)
    setClosing(false)
  }

  function close() {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) commit()
    else setClosing(true)
  }

  // ถ้ามี popup ค้างตอนเริ่ม closing แล้วคอมโพเนนต์ถูกถอด ให้ล้างสถานะ
  useEffect(() => {
    if (count === 0) setClosing(false)
  }, [count])

  if (count === 0) return null

  const first = fresh[0].email
  const desc = count === 1 ? first : `${first} และอีก ${count - 1} คน`

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') close()
  }

  return (
    <section
      aria-label="แจ้งเตือนผู้ใช้ใหม่"
      data-closing={closing}
      onKeyDown={onKeyDown}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) commit()
      }}
      className="anim-pop-in fixed left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] overflow-hidden rounded-2xl border border-line border-t-4 border-t-brand bg-surface shadow-xl sm:left-auto sm:w-[360px]"
    >
      <div className="flex items-start gap-3.5 p-4">
        {/* ไอคอน + badge จำนวน (pop แบบ badge-pop) */}
        <div className="relative shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-brand">
            <UserPlusIcon />
          </div>
          <span
            key={count}
            aria-hidden="true"
            className="badge-pop absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-ink bg-brand px-1 font-mono text-xs font-bold text-ink ring-2 ring-surface"
          >
            {count}
          </span>
        </div>

        <div role="status" className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">มีผู้ใช้ใหม่รออนุมัติ</p>
          <p className="mt-0.5 truncate text-sm text-ink/70" title={desc}>
            {desc}
          </p>
          <span className="sr-only">{count} คน</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={close}
          className="min-h-11 rounded-lg border border-ink/40 px-4 text-sm font-medium text-ink transition-colors hover:bg-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          ไว้ทีหลัง
        </button>
        <button
          type="button"
          onClick={() => {
            onReview()
            close()
          }}
          className="min-h-11 rounded-lg border border-ink bg-brand px-5 text-sm font-semibold text-ink transition-colors hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          ตรวจสอบ
        </button>
      </div>

      {/* แถบนับเวลา 12 วินาที แล้วปิดเอง */}
      <div className="h-1 bg-brand-soft" aria-hidden="true">
        <div className="timer-bar h-full bg-brand-dark" onAnimationEnd={close} />
      </div>
    </section>
  )
}

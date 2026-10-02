import { useEffect, useRef, useState, type ReactNode } from 'react'

export type PageKey = 'mine' | 'codec' | 'myjob'

type Entry = {
  page: PageKey
  label: string
  sub: string
  icon: ReactNode
  /** My job ใช้ได้เฉพาะ admin และ user */
  needsJob?: boolean
}

const iconCls = 'h-5 w-5 shrink-0'
const svg = (children: ReactNode) => (
  <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

/**
 * รายการเมนู (เรียงลงมาตามลำดับ) — แก้/เพิ่มที่นี่ที่เดียว
 * ลำดับแรกคือ "หน้าหลัก" (Dashboard เดิมที่เห็นข้อมูลเคสทั้งหมด)
 */
const MENU: Entry[] = [
  {
    page: 'mine',
    label: 'หน้าหลัก',
    sub: 'รับเอกสาร / ส่งเบิก',
    icon: svg(
      <>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>,
    ),
  },
  {
    page: 'codec',
    label: 'Code C',
    sub: 'เคสติด C หลังส่งเบิก',
    icon: svg(
      <>
        <path d="M12 3l9 16H3L12 3z" />
        <path d="M12 10v4M12 17v.01" />
      </>,
    ),
  },
  {
    page: 'myjob',
    label: 'My job',
    sub: 'เคสของสิทธิที่ฉันดูแล',
    needsJob: true,
    icon: svg(
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
        <path d="M3 13h18" />
      </>,
    ),
  },
]

interface Props {
  page: PageKey
  canJob: boolean
  onNavigate: (p: PageKey) => void
}

export default function NavMenu({ page, canJob, onNavigate }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)

  const entries = MENU.filter((e) => !e.needsJob || canJob)
  const current = MENU.find((e) => e.page === page)

  function close() {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  function go(p: PageKey) {
    onNavigate(p)
    close()
  }

  // ปิดเมื่อคลิกนอกเมนู หรือกด Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <>
      <div
        ref={wrapRef}
        className="relative"
        onMouseEnter={() => {
          window.clearTimeout(timer.current)
          setOpen(true)
        }}
        onMouseLeave={() => {
          // หน่วงนิดเดียวกันเมนูหายตอนเมาส์เลื่อนผ่านช่องว่าง
          timer.current = window.setTimeout(close, 180)
        }}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={
            'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ' +
            (open
              ? 'border-brand bg-brand text-ink'
              : 'border-white/30 text-white hover:border-brand hover:bg-brand hover:text-ink')
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          Menu
        </button>

        {open && (
          <div role="menu" className="menu-fade absolute left-0 top-full z-50 pt-2">
            <ul className="w-72 rounded-xl border border-ink/10 bg-white p-1.5 text-ink shadow-xl">
              {entries.map((e) => {
                const cur = e.page === page
                return (
                  <li key={e.page}>
                    <button
                      type="button"
                      role="menuitem"
                      aria-current={cur ? 'page' : undefined}
                      onClick={() => go(e.page)}
                      className={
                        'flex w-full items-center gap-3 rounded-lg border-l-4 px-3 py-2.5 text-left transition-colors ' +
                        (cur ? 'border-ink bg-brand' : 'border-transparent hover:bg-brand-soft')
                      }
                    >
                      {e.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-tight">{e.label}</span>
                        <span className="block text-sm text-ink/70">{e.sub}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {current && (
        <nav aria-label="หน้าปัจจุบัน" className="hidden items-center border-l border-white/25 pl-3 text-sm sm:flex">
          <span className="font-semibold text-brand">{current.label}</span>
        </nav>
      )}
    </>
  )
}

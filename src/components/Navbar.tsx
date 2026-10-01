import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'

interface Props {
  onAddCase: () => void
  onImportCases: () => void
  onUploadClaims: () => void
  onExport: () => void
  exportDisabled?: boolean
  onManageUsers: () => void
}

interface Leaf {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
}

interface Entry {
  key: string
  label: string
  icon: ReactNode
  onSelect?: () => void // ใช้เมื่อไม่มีเมนูย่อย
  disabled?: boolean
  children?: Leaf[]
}

/* ไอคอน SVG (stroke) — ไม่ใช้ emoji */
function Svg({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const I = {
  menu: (
    <Svg>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  home: (
    <Svg>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </Svg>
  ),
  folder: (
    <Svg>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  ),
  plus: (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  fileIn: (
    <Svg>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5" />
    </Svg>
  ),
  upload: (
    <Svg>
      <path d="M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Svg>
  ),
  download: (
    <Svg>
      <path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" />
    </Svg>
  ),
  users: (
    <Svg>
      <path d="M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" />
      <circle cx="10" cy="8" r="3" />
      <path d="M20 20v-1a4 4 0 0 0-3-3.9M15 5.1a3 3 0 0 1 0 5.8" />
    </Svg>
  ),
  sliders: (
    <Svg>
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  ),
}

function Chevron({ className = '' }: { className?: string }) {
  return (
    <Svg className={`h-4 w-4 ${className}`}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  )
}

const BREADCRUMB = ['IPD AR Discharge', 'รายการเคสผู้ป่วยใน']

export default function Navbar({
  onAddCase,
  onImportCases,
  onUploadClaims,
  onExport,
  exportDisabled,
  onManageUsers,
}: Props) {
  const { session, role, signOut } = useAuth()
  const isAdmin = role === 'admin'
  const email = session?.user.email ?? ''

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function closeMenu() {
    setOpen(false)
    setActive(null)
  }

  // ปิดเมื่อคลิกนอกเมนู / กด Esc
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActive(null)
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setActive(null)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const entries: Entry[] = [
    {
      key: 'home',
      label: 'หน้าแรก',
      icon: I.home,
      onSelect: () => window.scrollTo({ top: 0 }),
    },
  ]
  if (isAdmin) {
    entries.push({
      key: 'cases',
      label: 'จัดการเคส',
      icon: I.folder,
      children: [
        { key: 'add', label: 'เพิ่มเคส', icon: I.plus, onSelect: onAddCase },
        { key: 'import', label: 'นำเข้าเคสใหม่ (CSV)', icon: I.fileIn, onSelect: onImportCases },
        { key: 'claims', label: 'อัพโหลดสถานะเคลม (CSV)', icon: I.upload, onSelect: onUploadClaims },
      ],
    })
  }
  entries.push({
    key: 'export',
    label: 'Export Excel',
    icon: I.download,
    onSelect: onExport,
    disabled: exportDisabled,
  })
  if (isAdmin) {
    entries.push({
      key: 'settings',
      label: 'ตั้งค่า',
      icon: I.sliders,
      children: [{ key: 'users', label: 'จัดการสิทธิ์ผู้ใช้', icon: I.users, onSelect: onManageUsers }],
    })
  }

  function run(fn: () => void) {
    closeMenu()
    fn()
  }

  // ลูกศรขึ้น/ลง เลื่อนระหว่างรายการ, ขวา เปิดเมนูย่อย, ซ้าย กลับไปเมนูหลัก
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    const isTop = t.hasAttribute('data-top')
    const isSub = t.hasAttribute('data-sub')
    if (!isTop && !isSub) return

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const scope = isTop ? e.currentTarget : t.closest('[data-flyout]')
      const items = Array.from(
        scope?.querySelectorAll<HTMLElement>(isTop ? '[data-top]:not(:disabled)' : '[data-sub]:not(:disabled)') ?? [],
      )
      if (items.length === 0) return
      const i = items.indexOf(t)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(i + step + items.length) % items.length].focus()
    } else if (e.key === 'ArrowRight' && isTop && t.getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault()
      setActive(t.dataset.key ?? null)
      requestAnimationFrame(() => {
        e.currentTarget.querySelector<HTMLElement>('[data-flyout] [data-sub]:not(:disabled)')?.focus()
      })
    } else if (e.key === 'ArrowLeft' && isSub) {
      e.preventDefault()
      e.currentTarget.querySelector<HTMLElement>(`[data-top][data-key="${active}"]`)?.focus()
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        {/* ซ้าย: โลโก้ + ปุ่ม Menu + breadcrumb */}
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo className="h-8 w-8 shrink-0" />

          <div ref={wrapRef} className="relative">
            <button
              ref={btnRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => {
                setOpen((o) => !o)
                setActive(null)
              }}
              className={
                'flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink transition-colors ' +
                'hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 ' +
                (open ? 'bg-paper' : '')
              }
            >
              <span className="text-ink/70">{I.menu}</span>
              Menu
            </button>

            {open && (
              <div
                role="menu"
                aria-label="เมนูหลัก"
                onKeyDown={onMenuKey}
                className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
              >
                {entries.map((en) => {
                  const hasChildren = !!en.children?.length
                  const isActive = active === en.key
                  return (
                    <div
                      key={en.key}
                      className="relative"
                      onPointerEnter={(e) => {
                        // เมาส์ = เปิดเมนูย่อยเมื่อ hover (หน้าจอสัมผัสใช้การแตะ)
                        if (e.pointerType === 'mouse') setActive(hasChildren ? en.key : null)
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-top
                        data-key={en.key}
                        disabled={en.disabled}
                        aria-haspopup={hasChildren ? 'menu' : undefined}
                        aria-expanded={hasChildren ? isActive : undefined}
                        onClick={() => {
                          if (hasChildren) setActive(isActive ? null : en.key)
                          else if (en.onSelect) run(en.onSelect)
                        }}
                        className={
                          'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors ' +
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 disabled:opacity-40 ' +
                          (isActive ? 'bg-teal-soft/70 text-teal-dark' : 'text-ink hover:bg-paper')
                        }
                      >
                        <span className={isActive ? 'text-teal-dark' : 'text-ink/50'}>{en.icon}</span>
                        <span className="flex-1">{en.label}</span>
                        {hasChildren && (
                          <Chevron
                            className={
                              'transition-transform ' +
                              (isActive ? 'text-teal-dark max-sm:-rotate-90' : 'text-ink/40 max-sm:rotate-90')
                            }
                          />
                        )}
                      </button>

                      {hasChildren && isActive && (
                        // เดสก์ท็อป: เมนูย่อยเด้งออกด้านขวา / มือถือ: คลี่ลงด้านล่าง
                        <div
                          data-flyout
                          role="menu"
                          aria-label={en.label}
                          className="pl-4 sm:absolute sm:left-full sm:top-0 sm:w-72 sm:pl-1.5"
                        >
                          <div className="rounded-xl bg-surface p-1 max-sm:pt-0.5 sm:border sm:border-line sm:p-1.5 sm:shadow-lg">
                            {en.children!.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                role="menuitem"
                                data-sub
                                disabled={c.disabled}
                                onClick={() => run(c.onSelect)}
                                className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 disabled:opacity-40"
                              >
                                <span className="text-ink/50">
                                  <span className="block [&>svg]:h-[18px] [&>svg]:w-[18px]">{c.icon}</span>
                                </span>
                                <span className="flex-1">{c.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* breadcrumb */}
          <div className="hidden h-6 w-px bg-line md:block" aria-hidden="true" />
          <nav aria-label="breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
            {BREADCRUMB.map((c, i) => {
              const last = i === BREADCRUMB.length - 1
              return (
                <span key={c} className="flex items-center gap-1.5">
                  {i > 0 && <Chevron className="text-ink/30" />}
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={'truncate ' + (last ? 'font-semibold text-ink' : 'text-ink/50')}
                  >
                    {c}
                  </span>
                </span>
              )
            })}
          </nav>
          <span className="truncate text-sm font-semibold text-ink md:hidden">{BREADCRUMB[0]}</span>
        </div>

        {/* ขวา: ผู้ใช้ + ออกจากระบบ */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span className="text-sm text-ink">{email}</span>
            <span className={'text-xs font-medium ' + (isAdmin ? 'text-teal-dark' : 'text-ink/50')}>
              {isAdmin ? 'ผู้ดูแลระบบ (แก้ไขได้)' : 'ผู้ใช้งาน (ดูอย่างเดียว)'}
            </span>
          </div>
          <button
            onClick={signOut}
            className="h-9 rounded-lg border border-line px-3 text-xs font-medium text-ink/70 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  )
}

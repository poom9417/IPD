import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ROLE_INTRO, TOUR_LABEL, TOUR_STEPS } from '../lib/tourConfig'
import type { PageKey } from './NavMenu'

type Phase = 'off' | 'welcome' | 'tour' | 'final'

interface Props {
  page: PageKey
  onNavigate: (p: PageKey) => void
}

const PAD = 6
const MAX_TRIES = 30 // 30 x 100ms = 3 วินาที รอให้หน้า/ข้อมูลโหลดก่อนข้ามขั้นตอน

function setMenu(open: boolean) {
  document.body.dataset.tourMenu = open ? '1' : '0'
  window.dispatchEvent(new CustomEvent('ipd-tour-menu', { detail: open }))
}

export default function OnboardingTour({ page, onNavigate }: Props) {
  const { role, isDeveloper, onboarding, completeOnboarding } = useAuth()
  const [phase, setPhase] = useState<Phase>('off')
  const [replay, setReplay] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null)
  const [agree, setAgree] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirRef = useRef<1 | -1>(1)
  const elRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const autoStarted = useRef(false)

  const steps = useMemo(
    () => TOUR_STEPS.filter((s) => role && s.roles.includes(role) && (!s.dev || isDeveloper)),
    [role, isDeveloper],
  )
  const step = phase === 'tour' ? steps[i] : undefined

  // เริ่มอัตโนมัติ: login ครั้งแรก (หรือ version ใหม่) — ทำครั้งเดียวต่อการเปิดหน้าเว็บ
  useEffect(() => {
    if (onboarding === 'needed' && role && !autoStarted.current) {
      autoStarted.current = true
      setReplay(false)
      setI(0)
      setPhase('welcome')
    }
  }, [onboarding, role])

  // เริ่มด้วยมือ: ปุ่ม "คู่มือใช้งาน" บน Navbar
  useEffect(() => {
    const h = () => {
      setReplay(true)
      setI(0)
      setPhase('welcome')
    }
    window.addEventListener('ipd-tour-start', h)
    return () => window.removeEventListener('ipd-tour-start', h)
  }, [])

  const stop = useCallback(() => {
    setMenu(false)
    setPhase('off')
    setRect(null)
    elRef.current = null
    onNavigate('mine')
  }, [onNavigate])

  const measure = useCallback(() => {
    const el = elRef.current
    if (el && el.isConnected) setRect(el.getBoundingClientRect())
  }, [])

  // พาไปหน้า/เปิดเมนู แล้วรอ element เป้าหมาย
  useEffect(() => {
    if (phase !== 'tour') return
    const s = steps[i]
    if (!s) {
      setMenu(false)
      setPhase('final')
      return
    }
    let cancelled = false
    let tries = 0
    let timer: number | undefined
    setRect(null)
    elRef.current = null
    setMenu(!!s.menu)
    if (s.page !== page) onNavigate(s.page)

    const skip = () => {
      const next = i + dirRef.current
      if (next < 0) {
        dirRef.current = 1
        setI(i + 1)
      } else {
        setI(next)
      }
    }

    const find = () => {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`)
      if (el && el.getClientRects().length > 0) {
        const r = el.getBoundingClientRect()
        el.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? 'start' : 'center', inline: 'nearest' })
        elRef.current = el
        timer = window.setTimeout(() => !cancelled && measure(), 150)
        return
      }
      if (++tries >= MAX_TRIES) {
        skip()
        return
      }
      timer = window.setTimeout(find, 100)
    }
    timer = window.setTimeout(find, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, i, steps])

  // อัปเดตตำแหน่งเมื่อเลื่อน/ปรับขนาดหน้าจอ
  useEffect(() => {
    if (phase !== 'tour') return
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [phase, measure])

  // วางตำแหน่งกล่องคำอธิบาย (ล่างเป้าหมาย → บน → ถ้าไม่พอวางทับขอบล่างของจอ)
  useLayoutEffect(() => {
    if (!rect || !tipRef.current) {
      setTipPos(null)
      return
    }
    const tipH = tipRef.current.offsetHeight
    const tipW = tipRef.current.offsetWidth
    const vh = window.innerHeight
    const vw = window.innerWidth
    let top: number
    if (rect.bottom + PAD + 12 + tipH <= vh) top = rect.bottom + PAD + 12
    else if (rect.top - PAD - 12 - tipH >= 0) top = rect.top - PAD - 12 - tipH
    else top = vh - tipH - 12
    const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - tipW - 12))
    setTipPos({ top, left })
  }, [rect, i, phase])

  const next = useCallback(() => {
    dirRef.current = 1
    setI((v) => v + 1)
  }, [])
  const back = useCallback(() => {
    dirRef.current = -1
    setI((v) => Math.max(0, v - 1))
  }, [])
  const toFinal = useCallback(() => {
    setMenu(false)
    setAgree(false)
    setPhase('final')
  }, [])

  // กันการกด Tab/Enter ไปโดนปุ่มจริงด้านหลังระหว่างทัวร์
  useEffect(() => {
    if (phase !== 'tour') return
    const onKey = (e: KeyboardEvent) => {
      const inTip = tipRef.current?.contains(e.target as Node)
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !inTip)) {
        e.preventDefault()
        e.stopPropagation()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (!inTip && (e.key === ' ' || e.key === 'Tab')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [phase, next, back])

  async function confirm() {
    if (!replay) {
      setSaving(true)
      await completeOnboarding()
      setSaving(false)
    }
    stop()
  }

  if (phase === 'off' || !role) return null
  const intro = ROLE_INTRO[role]

  if (phase === 'welcome') {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
        <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border-4 border-brand bg-white p-6 text-ink shadow-2xl">
          <h2 className="text-xl font-bold">ยินดีต้อนรับสู่ระบบ IPD AR Discharge</h2>
          <p className="mt-3 text-sm">
            คุณเข้าระบบในฐานะ <span className="rounded-full border border-brand bg-brand-soft px-2.5 py-0.5 font-semibold">{intro.name}</span> สิ่งที่คุณทำได้:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {intro.can.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {isDeveloper && (
            <p className="mt-2 text-sm">คุณเป็น <b>Developer</b> (สิทธิ์ Admin + จำลองเป็น role อื่นได้) ทัวร์นี้แสดงตาม role ที่กำลังใช้อยู่</p>
          )}
          <p className="mt-3 text-sm text-ink/70">
            ทัวร์สั้นๆ นี้จะอธิบายว่าปุ่มแต่ละปุ่มทำอะไร และพาไปดูทุกหน้าที่คุณใช้ได้ ระหว่างทัวร์ปุ่มจะยังไม่ถูกกด ไม่มีข้อมูลใดถูกเปลี่ยน
          </p>
          <div className="mt-5 flex justify-end gap-2">
            {replay && (
              <button onClick={() => setPhase('off')} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium hover:bg-brand-soft">
                ปิด
              </button>
            )}
            <span className="mr-auto self-center text-xs text-ink/50">คู่มือ {TOUR_LABEL}</span>
            <button
              autoFocus
              onClick={() => {
                dirRef.current = 1
                setI(0)
                setPhase('tour')
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold hover:bg-brand-dark"
            >
              เริ่มทัวร์
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'final') {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-md rounded-2xl border-4 border-brand bg-white p-6 text-ink shadow-2xl">
          <h2 className="text-xl font-bold">ทัวร์จบแล้ว</h2>
          <p className="text-xs text-ink/50">คู่มือ {TOUR_LABEL}</p>
          <p className="mt-2 text-sm">ตอนนี้คุณรู้แล้วว่าแต่ละปุ่มทำอะไร และเข้าหน้าไหนได้บ้าง เปิดคู่มือนี้ซ้ำได้ที่ปุ่ม "คู่มือใช้งาน" ด้านบน</p>
          {!replay && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-[#f5b800]" />
              ฉันเข้าใจวิธีใช้งานแล้ว
            </label>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => {
                dirRef.current = -1
                setI(Math.max(0, steps.length - 1))
                setPhase('tour')
              }}
              className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium hover:bg-brand-soft"
            >
              ย้อนกลับ
            </button>
            <button onClick={stop} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium hover:bg-brand-soft">
              {replay ? 'ปิด' : 'ไว้ทีหลัง'}
            </button>
            {!replay && (
              <button
                onClick={confirm}
                disabled={!agree || saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold hover:bg-brand-dark disabled:opacity-40"
              >
                {saving ? 'กำลังบันทึก…' : 'ยืนยัน เริ่มใช้งาน'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // phase === 'tour'
  const vw = window.innerWidth
  const vh = window.innerHeight
  const hl = rect
    ? {
        left: Math.max(4, rect.left - PAD),
        top: Math.max(4, rect.top - PAD),
        width: Math.min(vw - 8, rect.width + PAD * 2),
        height: Math.min(vh - 8, rect.height + PAD * 2),
      }
    : null

  return (
    <>
      {/* ชั้นกันคลิกปุ่มจริงด้านหลัง */}
      <div className="fixed inset-0 z-[100]" aria-hidden />
      {hl ? (
        <div
          className="pointer-events-none fixed z-[101] rounded-xl border-[3px] border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.68)] transition-all duration-200 motion-reduce:transition-none"
          style={hl}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[101] bg-black/68" />
      )}
      <div
        ref={tipRef}
        role="dialog"
        aria-live="polite"
        className="fixed z-[102] w-[min(360px,calc(100vw-24px))] rounded-xl border-2 border-brand bg-white p-4 text-ink shadow-2xl"
        style={tipPos ? { top: tipPos.top, left: tipPos.left } : { top: -9999, left: 0 }}
      >
        {step ? (
          <>
            <h3 className="text-base font-bold">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink/80">{step.body}</p>
          </>
        ) : (
          <p className="text-sm text-ink/70">กำลังพาไปยังหน้าถัดไป…</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-ink/60">
            {i + 1} / {steps.length}
          </span>
          <span className="flex-1" />
          <button onClick={toFinal} className="rounded-lg px-2 py-1.5 text-sm text-ink/70 underline hover:text-ink">
            ข้าม
          </button>
          <button
            onClick={back}
            disabled={i === 0}
            className="rounded-lg border border-ink/40 px-3 py-1.5 text-sm font-medium hover:bg-brand-soft disabled:opacity-40"
          >
            ย้อนกลับ
          </button>
          <button autoFocus onClick={next} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold hover:bg-brand-dark">
            {i === steps.length - 1 ? 'เสร็จสิ้น' : 'ถัดไป'}
          </button>
        </div>
      </div>
    </>
  )
}

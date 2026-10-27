import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { AppRole, UiRole } from '../lib/types'
import { TOUR_VERSION } from '../lib/tourConfig'

export type OnboardingState = 'unknown' | 'needed' | 'done'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

function viewAsKey(uid: string) {
  return `ipd_view_as_${uid}`
}

function tourKey(uid: string) {
  return `ipd_tour_v${TOUR_VERSION}_${uid}`
}

interface AuthState {
  session: Session | null
  /** role ที่ใช้ตัดสินหน้าจอ/ปุ่มทั้งแอป: developer → admin (หรือ role ที่กำลังจำลอง) */
  role: UiRole | null
  /** role จริงใน DB (ไม่เปลี่ยนตามโหมดจำลอง) */
  realRole: AppRole | null
  isDeveloper: boolean
  /** เลือกสิทธิ (My claim) ให้ผู้อื่นได้: เฉพาะ developer ที่ไม่ได้จำลอง role อื่น (ฐานข้อมูลเช็ค role จริงซ้ำ) */
  canAssign: boolean
  /** role ที่ developer กำลังจำลองอยู่ (null = ไม่ได้จำลอง) */
  viewAs: UiRole | null
  setViewAs: (r: UiRole | null) => void
  roleLoading: boolean
  /** สถานะการอนุมัติเข้าใช้งาน (null = ยังโหลดไม่เสร็จ) */
  approval: ApprovalStatus | null
  onboarding: OnboardingState
  completeOnboarding: () => Promise<void>
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

const ALLOWED_DOMAIN = 'mahidol.ac.th'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [realRole, setRealRole] = useState<AppRole | null>(null)
  const [viewAsState, setViewAsState] = useState<UiRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(false)
  const [onboarding, setOnboarding] = useState<OnboardingState>('unknown')
  const [approval, setApproval] = useState<ApprovalStatus | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      // Supabase ยิง event (SIGNED_IN / TOKEN_REFRESHED) ทุกครั้งที่กลับมาที่แท็บ พร้อม session ก้อนใหม่
      // ถ้าเป็นผู้ใช้คนเดิม ให้ใช้ค่าเดิมต่อ (อัปเดตเฉพาะตอน token เปลี่ยน) จะได้ไม่ทำให้ทั้งแอปโหลดใหม่
      setSession((prev) => {
        if (prev && s && prev.user.id === s.user.id) {
          return prev.access_token === s.access_token ? prev : s
        }
        return s
      })
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // ใช้ id ผู้ใช้เป็นตัวกระตุ้นแทนก้อน session ทั้งก้อน — การต่ออายุ token ไม่ทำให้โหลดสิทธิ์ซ้ำ/จอโหลดกะพริบ
  // (ถ้าสลับบัญชีหรือออกจากระบบ uid เปลี่ยน → ตรวจสิทธิ์ใหม่ทุกครั้งตามเดิม)
  const uid = session?.user.id ?? null

  useEffect(() => {
    if (!uid) {
      setRealRole(null)
      setViewAsState(null)
      setOnboarding('unknown')
      setApproval(null)
      return
    }
    let cancelled = false
    setRoleLoading(true)
    type Row = { role: string; onboarded_at?: string | null; tour_version?: number | null }
    ;(async () => {
      // ตรวจสถานะอนุมัติก่อน — ถ้ายังไม่อนุมัติ ไม่ต้องโหลดอย่างอื่น
      const ap = await supabase.from('app_users').select('approval_status').eq('id', uid).maybeSingle()
      if (cancelled) return
      // อ่านสถานะไม่ได้ (error) → ถือว่ายังไม่อนุมัติ (fail-closed) เพื่อความปลอดภัยของข้อมูลผู้ป่วย
      const status: ApprovalStatus = ap.error
        ? 'pending'
        : ((ap.data as { approval_status?: ApprovalStatus } | null)?.approval_status ?? 'pending')
      setApproval(status)
      if (status !== 'approved') {
        setRealRole(null)
        setRoleLoading(false)
        return
      }
      let row: Row | null = null
      let legacy = false
      const full = await supabase.from('app_users').select('role, onboarded_at, tour_version').eq('id', uid).single()
      if (!full.error && full.data) {
        row = full.data as Row
      } else {
        // คอลัมน์ onboarding ยังไม่ถูกสร้าง (ยังไม่ได้รัน add_onboarding.sql) → อ่านแค่ role แล้วจำสถานะทัวร์ในเบราว์เซอร์แทน
        const basic = await supabase.from('app_users').select('role').eq('id', uid).single()
        row = (basic.data as Row | null) ?? null
        legacy = true
      }
      if (cancelled) return
      setRealRole((row?.role as AppRole) ?? null)
      // คืนโหมดจำลองที่ค้างไว้ในแท็บนี้ (ใช้ได้เฉพาะ developer — ตรวจซ้ำตอนคำนวณ role ด้านล่าง)
      try {
        const saved = sessionStorage.getItem(viewAsKey(uid)) as UiRole | null
        setViewAsState(saved && ['admin', 'user', 'audit', 'viewer'].includes(saved) ? saved : null)
      } catch {
        /* ignore */
      }
      if (!row) {
        setOnboarding('unknown')
      } else if (legacy) {
        let seen = false
        try {
          seen = localStorage.getItem(tourKey(uid)) === '1'
        } catch {
          /* ignore */
        }
        setOnboarding(seen ? 'done' : 'needed')
      } else {
        setOnboarding(row.onboarded_at && (row.tour_version ?? 0) >= TOUR_VERSION ? 'done' : 'needed')
      }
      setRoleLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [uid])

  // ระหว่างรออนุมัติ: เช็กสถานะซ้ำทุก 15 วินาที พออนุมัติแล้วเข้าได้เองโดยไม่ต้องล็อกอินใหม่
  useEffect(() => {
    if (!uid || approval === null || approval === 'approved') return
    const t = setInterval(async () => {
      const { data } = await supabase.from('app_users').select('approval_status').eq('id', uid).maybeSingle()
      const next = (data as { approval_status?: ApprovalStatus } | null)?.approval_status
      if (next === 'approved') {
        // โหลดใหม่ทั้งหน้าเพื่อดึง role/ข้อมูลล่าสุดให้ครบ
        window.location.reload()
      } else if (next && next !== approval) {
        setApproval(next)
      }
    }, 15000)
    return () => clearInterval(t)
  }, [uid, approval])

  // จำลอง role ได้เฉพาะ developer เท่านั้น (เป็นการจำลองฝั่งหน้าจอ — ไม่แตะ role จริงใน DB)
  const isDeveloper = realRole === 'developer'
  const viewAs: UiRole | null = isDeveloper ? viewAsState : null
  const role: UiRole | null = realRole === null ? null : isDeveloper ? (viewAs ?? 'admin') : realRole

  const canAssign = isDeveloper && viewAs === null

  function setViewAs(r: UiRole | null) {
    if (!isDeveloper) return
    setViewAsState(r)
    const uid = session?.user.id
    if (!uid) return
    try {
      if (r) sessionStorage.setItem(viewAsKey(uid), r)
      else sessionStorage.removeItem(viewAsKey(uid))
    } catch {
      /* ignore */
    }
  }

  async function completeOnboarding() {
    const uid = session?.user.id
    if (!uid) return
    const { error } = await supabase.rpc('complete_onboarding', { p_version: TOUR_VERSION })
    if (error) {
      try {
        localStorage.setItem(tourKey(uid), '1')
      } catch {
        /* ignore */
      }
    }
    setOnboarding('done')
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // "hd" narrows the Google account chooser to the org domain.
        // This is a UI convenience only — the real enforcement is the
        // Postgres trigger + RLS policies on the Supabase side.
        queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
        redirectTo: window.location.origin,
      },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, role, realRole, isDeveloper, canAssign, viewAs, setViewAs, roleLoading, approval, onboarding, completeOnboarding, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { AppRole, UiRole } from '../lib/types'
import { TOUR_VERSION } from '../lib/tourConfig'

export type OnboardingState = 'unknown' | 'needed' | 'done'

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
  /** เลือกสิทธิ (My claim) ให้ผู้อื่นได้: audit หรือ developer ที่ไม่ได้จำลอง role อื่น (ฐานข้อมูลเช็ค role จริงซ้ำ) */
  canAssign: boolean
  /** role ที่ developer กำลังจำลองอยู่ (null = ไม่ได้จำลอง) */
  viewAs: UiRole | null
  setViewAs: (r: UiRole | null) => void
  roleLoading: boolean
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setRealRole(null)
      setViewAsState(null)
      setOnboarding('unknown')
      return
    }
    const uid = session.user.id
    setRoleLoading(true)
    type Row = { role: string; onboarded_at?: string | null; tour_version?: number | null }
    ;(async () => {
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
  }, [session])

  // จำลอง role ได้เฉพาะ developer เท่านั้น (เป็นการจำลองฝั่งหน้าจอ — ไม่แตะ role จริงใน DB)
  const isDeveloper = realRole === 'developer'
  const viewAs: UiRole | null = isDeveloper ? viewAsState : null
  const role: UiRole | null = realRole === null ? null : isDeveloper ? (viewAs ?? 'admin') : realRole

  const canAssign = role === 'audit' || (isDeveloper && viewAs === null)

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
    <AuthContext.Provider value={{ session, role, realRole, isDeveloper, canAssign, viewAs, setViewAs, roleLoading, onboarding, completeOnboarding, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

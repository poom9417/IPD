import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { AppRole } from '../lib/types'
import { TOUR_VERSION } from '../lib/tourConfig'

export type OnboardingState = 'unknown' | 'needed' | 'done'

function tourKey(uid: string) {
  return `ipd_tour_v${TOUR_VERSION}_${uid}`
}

interface AuthState {
  session: Session | null
  role: AppRole | null
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
  const [role, setRole] = useState<AppRole | null>(null)
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
      setRole(null)
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
      setRole((row?.role as AppRole) ?? null)
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
    <AuthContext.Provider value={{ session, role, roleLoading, onboarding, completeOnboarding, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

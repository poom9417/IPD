import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { AppRole } from '../lib/types'

interface AuthState {
  session: Session | null
  role: AppRole | null
  roleLoading: boolean
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
      return
    }
    setRoleLoading(true)
    supabase
      .from('app_users')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRole((data?.role as AppRole) ?? null)
        setRoleLoading(false)
      })
  }, [session])

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
    <AuthContext.Provider value={{ session, role, roleLoading, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

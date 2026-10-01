import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './components/Login'
import AppLayout from './components/AppLayout'
import { supabaseConfigError } from './lib/supabaseClient'

function Shell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink/50">
        กำลังโหลด…
      </div>
    )
  }

  return session ? <AppLayout /> : <Login />
}

export default function App() {
  if (supabaseConfigError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-rose-soft bg-rose-soft/40 p-6 text-sm text-ink">
          <p className="mb-2 font-semibold text-rose">ตั้งค่าระบบไม่ครบ</p>
          <p>{supabaseConfigError}</p>
        </div>
      </div>
    )
  }

  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

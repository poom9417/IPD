import { useAuth } from '../contexts/AuthContext'

export default function Navbar() {
  const { session, role, signOut } = useAuth()
  const email = session?.user.email ?? ''

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-dark text-xs font-semibold text-white">
            AR
          </div>
          <div>
            <p className="text-sm font-semibold leading-none text-ink">IPD AR Discharge</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm text-ink">{email}</span>
            <span
              className={
                'text-xs font-medium ' +
                (role === 'admin' ? 'text-teal-dark' : 'text-ink/50')
              }
            >
              {role === 'admin' ? 'ผู้ดูแลระบบ (แก้ไขได้)' : 'ผู้ใช้งาน (ดูอย่างเดียว)'}
            </span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-paper transition-colors"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  )
}

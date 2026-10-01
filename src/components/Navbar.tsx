import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'
import UserManagement from './UserManagement'

export default function Navbar() {
  const { session, role, signOut } = useAuth()
  const email = session?.user.email ?? ''
  const [showUsers, setShowUsers] = useState(false)

  return (
    <header className="border-b-4 border-brand bg-ink text-white">
      <div className="flex w-full items-center justify-between px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="h-10 w-10" />
          <div>
            <p className="text-base font-semibold leading-none text-white">IPD AR Discharge</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm text-white">{email}</span>
            <span
              className={
                'text-xs font-medium ' +
                (role === 'admin' ? 'text-brand' : 'text-white/60')
              }
            >
              {role === 'admin' ? 'ผู้ดูแลระบบ (แก้ไขได้)' : 'ผู้ใช้งาน (ดูอย่างเดียว)'}
            </span>
          </div>
          {role === 'admin' && (
            <button
              onClick={() => setShowUsers(true)}
              className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
            >
              จัดการผู้ใช้
            </button>
          )}
          <button
            onClick={signOut}
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </header>
  )
}
